/**
 * ClaudeAgentSdkAdapter — uses @anthropic-ai/claude-agent-sdk (formerly Claude Code SDK).
 *
 * OAuth authentication is handled inside the SDK using the user's existing
 * Claude Code / Claude.ai login — no API key required for OAuth users.
 * Falls back to ANTHROPIC_API_KEY if set (for CI / API-key users).
 *
 * The SDK exposes a `query()` function that returns an AsyncGenerator of SDKMessage.
 * We map the relevant message types to our ProviderEvent shape.
 *
 * Relevant SDKMessage types we handle:
 *   - 'assistant'      → extract text_block content → text-delta events
 *   - 'stream_event'   → BetaRawMessageStreamEvent deltas (fine-grained streaming)
 *   - 'result'         → done event with usage
 *   - 'assistant' with error field → error event
 */
import type { LLMProvider, ProviderEvent, QueryRequest, ProbeResult } from '../core/provider.js';
import type { AgentToolDeps } from '../agent/tools/index.js';

// SDK types we need — imported as `type` to avoid pulling the entire SDK at import time
// when it's not the active provider. The actual runtime import happens inside the methods.
// (TypeScript will still type-check via the type imports at compile time.)
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export type ClaudeAgentSdkConfig = {
  model?: string;
  /** Optional default system prompt (overridden per-request via QueryRequest.systemPrompt). */
  systemPrompt?: string;
};

export type ClaudeAgentSdkDeps = {
  search?: AgentToolDeps['search'];
};

const DEFAULT_SYSTEM_PROMPT = `You are llm-wiki, a knowledge assistant. The user has a canvas where you can place widgets to visualize answers spatially.

Use tools when visual presentation aids the answer (lookups across sources, multi-item synthesis, walkthroughs). Reply with text only for chitchat, clarifications, follow-ups about content already on the canvas, or simple factual questions.

Widget kinds: markdown, code-block, ticket, web-embed, key-value-card.
Roles: primary (main subject), detail (depth on primary), related (adjacent), reference (citations), timeline (time-anchored), node (graph node).

Search before citing — never invent ids, urls, or quotes.`;

/**
 * Stub search adapter used when the adapter is constructed without `deps.search`
 * (tests, probes). Returns nothing rather than throwing so the agent loop can
 * still run end-to-end without a wired BackendState.
 */
function buildLazySearchAdapter(): AgentToolDeps['search'] {
  return {
    async search() {
      return [];
    },
    async fetchById() {
      return null;
    },
  };
}

export class ClaudeAgentSdkAdapter implements LLMProvider {
  readonly id = 'claude-agent-sdk';
  readonly name = 'Claude Agent SDK';
  readonly kind = 'agent' as const;

  constructor(
    private readonly config: ClaudeAgentSdkConfig = {},
    private readonly deps: ClaudeAgentSdkDeps = {},
  ) {}

  async *query(request: QueryRequest): AsyncIterable<ProviderEvent> {
    // Dynamic import keeps startup fast when this provider is not active.
    const { query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk');

    // Pass system prompt through the SDK option (NOT prepended to the user
    // prompt) so the model treats it as a system role. Using a simple string
    // also skips the default Claude Code preset, which loads dynamic
    // sections (cwd, memory, git status) that can produce empty cache_control
    // text blocks the Anthropic API now rejects.
    const systemPrompt =
      request.systemPrompt ??
      this.config.systemPrompt ??
      DEFAULT_SYSTEM_PROMPT;

    // Clean working directory — process.cwd() includes a git repo + lots of
    // files which the SDK can use to produce dynamic context blocks. A
    // freshly-created tempdir gives the SDK nothing to introspect.
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const cleanCwd = mkdtempSync(join(tmpdir(), 'llm-wiki-sdk-'));

    // Mirror the caller's abort signal into a fresh AbortController owned by
    // this turn. The SDK accepts an `abortController` (not a signal) so we
    // proxy the external signal through to it.
    const abortController = new AbortController();
    if (request.abortSignal) {
      if (request.abortSignal.aborted) abortController.abort();
      else
        request.abortSignal.addEventListener(
          'abort',
          () => abortController.abort(),
          { once: true },
        );
    }

    const { buildAgentTools } = await import('../agent/tools/index.js');
    const { createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');

    const search = this.deps.search ?? buildLazySearchAdapter();
    const snapshot =
      request.canvasSnapshot ?? {
        activeTemplateId: 'ask-anything' as const,
        widgets: [],
      };
    const tools = buildAgentTools({ search, getSnapshot: () => snapshot });

    const mcp = createSdkMcpServer({
      name: 'llm-wiki-tools',
      version: '0.1.0',
      // Each tool factory returns a `WithArgs<...>` cast (handlers accept the
      // public, optional-friendly args type). createSdkMcpServer's parameter
      // is typed against the SDK's stricter InferShape variant, so we widen
      // here. The runtime contract is identical.
      tools: tools as unknown as Parameters<typeof createSdkMcpServer>[0]['tools'],
    });

    const options: Record<string, unknown> = {
      systemPrompt,
      // Don't load .claude/settings.json from the filesystem.
      settingSources: [],
      // Run the SDK from an empty tempdir so it has no project files,
      // no git status, no CLAUDE.md, no AGENTS.md to inject as context.
      cwd: cleanCwd,
      // No file-checkpointing context blocks.
      enableFileCheckpointing: false,
      // No session forking artifacts.
      forkSession: false,
      // No custom agents.
      agents: {},
      // In-process MCP server hosting our 9 agent tools. The SDK invokes
      // them by `mcp__<server>__<tool>` — we name the server `llm-wiki`.
      mcpServers: { 'llm-wiki': mcp },
      allowedTools: tools.map((t) => `mcp__llm-wiki__${t.name}`),
      maxTurns: 10,
      maxOutputTokens: 8192,
      effort: 'medium',
      thinking: { type: 'adaptive', display: 'summarized' },
      abortController,
    };
    if (this.config.model) options.model = this.config.model;

    const sdkQuery_ = sdkQuery({ prompt: request.prompt, options });

    try {
      for await (const message of sdkQuery_) {
        const events = this.mapMessage(message as SDKMessage);
        for (const event of events) {
          yield event;
        }
      }
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  mapMessage(message: SDKMessage): ProviderEvent[] {
    const events: ProviderEvent[] = [];

    if (message.type === 'assistant') {
      // If the assistant message has an error, emit an error event
      if (message.error) {
        events.push({ type: 'error', message: `SDK error: ${message.error}` });
        return events;
      }
      // Extract text and thinking blocks from the message content
      for (const block of message.message.content) {
        if (block.type === 'text') {
          events.push({ type: 'text-delta', text: block.text });
        } else if (block.type === 'thinking') {
          events.push({ type: 'thinking-delta', text: block.thinking });
        } else if (block.type === 'tool_use') {
          events.push({
            type: 'tool-call',
            toolCallId: block.id,
            name: block.name,
            input: block.input,
          });
        }
      }
    } else if (message.type === 'stream_event') {
      // Fine-grained streaming events — emit text deltas as they arrive
      const event = message.event;
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        events.push({ type: 'text-delta', text: event.delta.text });
      } else if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'thinking_delta'
      ) {
        events.push({ type: 'thinking-delta', text: event.delta.thinking });
      }
    } else if (message.type === 'result') {
      if (message.subtype === 'success') {
        events.push({
          type: 'done',
          usage: {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
          },
        });
      } else {
        // result with error subtype
        events.push({ type: 'error', message: 'Query ended with error result' });
        events.push({ type: 'done' });
      }
    } else if (message.type === 'user') {
      // The SDK pipes tool execution results back as user-role messages whose
      // content array carries `tool_result` blocks correlated to the assistant's
      // earlier `tool_use` block via `tool_use_id`. We forward them as
      // `tool-result` ProviderEvents so UIMS can correlate the call/result pair.
      const content = message.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (
            typeof block === 'object' &&
            block !== null &&
            (block as { type?: string }).type === 'tool_result'
          ) {
            const tr = block as {
              type: 'tool_result';
              tool_use_id: string;
              content?: string | Array<{ type: string; text?: string }>;
              is_error?: boolean;
            };
            const isError = tr.is_error === true;
            const rawContent = tr.content;
            const output =
              typeof rawContent === 'string'
                ? rawContent
                : Array.isArray(rawContent)
                  ? rawContent
                      .filter((c) => c.type === 'text')
                      .map((c) => c.text ?? '')
                      .join('')
                  : rawContent;
            events.push({
              type: 'tool-result',
              toolCallId: tr.tool_use_id,
              // SDK doesn't carry the tool name on tool_result blocks; UIMS only
              // needs toolCallId to correlate with the prior tool-call event.
              name: '',
              output,
              isError,
            });
          }
        }
      }
    }

    return events;
  }

  async probe(): Promise<ProbeResult> {
    const start = Date.now();
    try {
      // Just import the SDK to verify it's installed and importable.
      // We don't make a real API call here — that requires auth and network.
      await import('@anthropic-ai/claude-agent-sdk');
      const latencyMs = Date.now() - start;
      return { ok: true, latencyMs };
    } catch (err) {
      return {
        ok: false,
        error: `Claude Agent SDK not available: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
}

/**
 * Test-only re-export so __tests__ can exercise the mapper without spinning
 * up the SDK. Not part of the public API.
 */
export function mapMessageForTesting(message: SDKMessage): ProviderEvent[] {
  return new ClaudeAgentSdkAdapter().mapMessage(message);
}

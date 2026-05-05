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

/**
 * Configured external MCP server (filesystem, Confluence, Jira, etc.) the
 * agent should be able to call. We pass `config` straight through to the
 * SDK's `mcpServers` option; `toolNames` is the introspected list of tools
 * exposed by that server (used to widen `allowedTools` so they're permitted).
 */
export type ExternalMcpSource = {
  /** Logical name for the SDK; tool calls become `mcp__<name>__<tool>`. */
  name: string;
  /** SDK-shaped server config (stdio/sse/http). */
  config: {
    type?: 'stdio' | 'sse' | 'http';
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    headers?: Record<string, string>;
    /** Eagerly inject tool schemas — saves a ToolSearch round-trip per turn. */
    alwaysLoad?: boolean;
  };
  toolNames: string[];
};

export type ClaudeAgentSdkDeps = {
  search?: AgentToolDeps['search'];
  webSearch?: AgentToolDeps['webSearch'];
  /**
   * Async getter so the adapter can pull the latest source list per chat turn
   * without forcing source connection at construction time. Returns whatever
   * sources have been connected + introspected so far; never throws.
   */
  getExternalMcpSources?: () => Promise<ExternalMcpSource[]>;
};

/**
 * The full set of Claude Agent SDK built-in tools. We disallow all of them
 * so the only tool surface the model sees is our `mcp__strata__*` namespace.
 * Without this, the model can fall back to e.g. SDK `WebSearch` when our
 * MCP `web_search` returns empty, which triggers a permission prompt the
 * non-interactive backend can't satisfy.
 */
const SDK_BUILTIN_TOOLS = [
  'Bash',
  'BashOutput',
  'Edit',
  'ExitPlanMode',
  'Glob',
  'Grep',
  'KillShell',
  'NotebookEdit',
  'Read',
  'Skill',
  'SlashCommand',
  'Task',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Write',
];

const DEFAULT_SYSTEM_PROMPT = `You are Strata, a knowledge assistant. The user has a canvas where you can place widgets to visualize answers spatially.

When the user asks about a topic, ALWAYS call \`search_kb\` first. Do not ask for clarification on what to search — try a reasonable query against what they actually said. Only ask the user back if their message is genuinely ambiguous (e.g. a single pronoun with no antecedent).

Reply with text only when the question is pure chitchat ("hi", "thanks") or a follow-up about a widget already on the canvas. Otherwise: search, then place at least one widget summarizing what you found, then a short text reply pointing to the placement.

Widget kinds: markdown (rich text), code-block (source code with language), ticket (issue/task with id+status), web-embed (url+title), key-value-card (label/value pairs — use the field name **fields**, not items), table (rows × columns — for query results, comparisons, lists with multiple attributes), timeline (chronological events — for histories, activity, releases), file-tree (hierarchical files+dirs — for project structure, search results).
Roles: primary (main subject), detail (depth on primary), related (adjacent), reference (citations), timeline (time-anchored), node (graph node).

Tool selection:
- \`search_kb\` first for anything plausibly in the user's local index (their docs, code, tickets, prior conversations).
- \`web_search\` when the answer needs current public information — recent news, library docs, prices, or anything time-sensitive — OR after \`search_kb\` returned no relevant hits and the topic clearly isn't in the user's KB.
- Place a \`web-embed\` widget for web hits (payload: { title, url, snippet }).

Code widgets — context matters:
- \`search_kb\` returns ~500-char chunks with file URIs. Those snippets alone are not enough context to read.
- BEFORE placing a \`code-block\`, fetch the surrounding code: use the filesystem MCP server (\`read_text_file\` if configured) on the chunk's URI path, OR \`fetch_result\` on related chunk ids that hit the same file.
- The widget's \`code\` field should contain the full function definition (or top-N lines of the file), not just the matched snippet. Aim for enough context that a reader doesn't have to open the file separately.

Sources & attribution:
- Every payload supports an optional \`source\` field — set it on every widget you place. For KB hits: the chunk's source id (e.g. \`local-code:./src\`). For web hits: the page URL. For MCP hits: the source name. The UI shows it as a footer so users can click through.

Never invent ids, urls, or quotes — only cite what \`search_kb\`, \`fetch_result\`, \`web_search\`, or an MCP tool returned.`;

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

function buildLazyWebSearch(): AgentToolDeps['webSearch'] {
  return {
    async search() {
      return [];
    },
  };
}

/**
 * Render a system-prompt section listing the user's externally configured MCP
 * sources and their tool names. Without this the model only knows about
 * strata's built-in tools and won't attempt mcp__<source>__<tool> calls.
 */
function renderExternalToolsBlock(sources: ExternalMcpSource[]): string {
  const lines = sources.map((s) => {
    const tools = s.toolNames.join(', ');
    return `- **${s.name}** (call as \`mcp__${s.name}__<tool>\`): ${tools}`;
  });
  return `External tools available (the user has configured these MCP sources — call them when the question maps to one):\n${lines.join('\n')}\n\nFor filesystem-style sources, prefer reading specific files (\`read_text_file\`, \`list_directory\`) over recursive walks. Cite paths only when verified.`;
}

/**
 * If the user has widgets selected on the canvas when they sent the
 * message, surface those specifically to the model so it can scope
 * follow-ups to those widgets ("explain this", "compare these two"). The
 * snapshot's full widgets[] is also visible, but the model needs an
 * explicit pointer at the user's focus.
 */
function renderSelectionBlock(snapshot?: import('../agent/canvas-snapshot.js').CanvasSnapshot): string | null {
  if (!snapshot?.selectedIds || snapshot.selectedIds.length === 0) return null;
  const selected = snapshot.widgets.filter((w) =>
    snapshot.selectedIds!.includes(w.id),
  );
  if (selected.length === 0) return null;
  const lines = selected.map(
    (w) => `- ${w.kind} (${w.role}) "${w.title}" — id ${w.id}`,
  );
  return `Selected widgets — the user has these specifically in focus and likely wants follow-ups about them. If the message says "this", "these", "explain it" without other antecedent, treat the most recent message as referring to these widgets:\n${lines.join('\n')}\n\nUse \`read_widget\` with one of these ids to see the full payload before answering.`;
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

    // rawPrompt: bypass agent framing entirely — used by QaEnricher to call
    // the LLM as a plain text-completion. No MCP tools, no system prompt
    // (caller passes its own via systemPrompt if needed), no thinking, no
    // session resume. The SDK still owns the connection but acts as a
    // simple LLM client.
    if (request.rawPrompt) {
      yield* this.queryRaw(request, sdkQuery);
      return;
    }

    // Pass system prompt through the SDK option (NOT prepended to the user
    // prompt) so the model treats it as a system role. Using a simple string
    // also skips the default Claude Code preset, which loads dynamic
    // sections (cwd, memory, git status) that can produce empty cache_control
    // text blocks the Anthropic API now rejects.
    // Resolve external MCP sources up front so we can append them to the
    // system prompt — without that block the model assumes only strata tools
    // exist and never attempts mcp__<source-name>__<tool> calls.
    const externalSources = this.deps.getExternalMcpSources
      ? await this.deps.getExternalMcpSources().catch((e) => {
          console.error('[claude-agent-sdk] failed to load external MCP sources:', e);
          return [];
        })
      : [];

    const baseSystemPrompt =
      request.systemPrompt ??
      this.config.systemPrompt ??
      DEFAULT_SYSTEM_PROMPT;

    const blocks: string[] = [baseSystemPrompt];
    if (externalSources.length > 0) {
      blocks.push(renderExternalToolsBlock(externalSources));
    }
    const selectionBlock = renderSelectionBlock(request.canvasSnapshot);
    if (selectionBlock) blocks.push(selectionBlock);
    const systemPrompt = blocks.join('\n\n');

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
    const webSearch = this.deps.webSearch ?? buildLazyWebSearch();
    // externalSources resolved earlier to feed the system prompt.
    const snapshot =
      request.canvasSnapshot ?? {
        activeTemplateId: 'ask-anything' as const,
        widgets: [],
      };
    const tools = buildAgentTools({
      search,
      webSearch,
      getSnapshot: () => snapshot,
    });

    const mcp = createSdkMcpServer({
      name: 'strata-tools',
      version: '0.1.0',
      // Eagerly inject all tool schemas into the prompt. Without this the SDK
      // makes the model call the built-in `ToolSearch` first to discover
      // schemas, which burns one round-trip per chat turn. With 9 small tools
      // the upfront prompt cost is well under the budget.
      alwaysLoad: true,
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
      // NOTE: deliberately NOT setting `cwd: cleanCwd` here — the SDK
      // announces its cwd as an MCP "root" to spawned MCP servers, which
      // OVERRIDES the allowed-paths args we pass them. Letting cwd default
      // to the backend process's cwd means filesystem MCP servers honor
      // their args (e.g. `/Users/foo/Development`) instead of being pinned
      // to a fresh tempdir. The cache_control bug that motivated the
      // tempdir is gone now that we use a string systemPrompt (not the
      // 'claude_code' preset that loads CLAUDE.md/AGENTS.md/etc.).
      // No file-checkpointing context blocks.
      enableFileCheckpointing: false,
      // No session forking artifacts.
      forkSession: false,
      // No custom agents.
      agents: {},
      // MCP servers exposed to the agent.
      //   - `strata`: in-process server hosting our 10 agent tools.
      //   - one entry per externally-configured source (filesystem, Confluence,
      //     Jira, etc.) so the agent can call user-defined tools by
      //     `mcp__<source.name>__<tool>`. The SDK manages the process.
      mcpServers: {
        strata: mcp,
        ...Object.fromEntries(externalSources.map((s) => [s.name, s.config])),
      },
      allowedTools: [
        ...tools.map((t) => `mcp__strata__${t.name}`),
        ...externalSources.flatMap((s) =>
          s.toolNames.map((t) => `mcp__${s.name}__${t}`),
        ),
      ],
      // Disallow every SDK built-in tool (Bash/Read/Edit/WebSearch/etc.) so
      // the model can't fall back to them when our MCP tools return empty.
      // Without this, the SDK's WebSearch fires when our `web_search` returns
      // [] (e.g. no TAVILY_API_KEY), surfacing a confusing permission prompt.
      disallowedTools: SDK_BUILTIN_TOOLS,
      // Default permission mode prompts the user for unknown tools — for
      // a non-interactive backend that just yields permission errors.
      // 'dontAsk' = deny instead of prompt for anything not allow-listed.
      permissionMode: 'dontAsk' as const,
      // 20 covers most real research queries (KB search + 2-3 fetches +
      // 2-4 widget placements + occasional web/MCP fan-out + final reply).
      // Original 10 was too conservative once tool variety grew.
      maxTurns: 20,
      maxOutputTokens: 8192,
      effort: 'medium',
      thinking: { type: 'adaptive', display: 'summarized' },
      abortController,
    };
    if (this.config.model) options.model = this.config.model;
    // resume: rehydrate the prior native session so the model has full
    // turn-by-turn context without us replaying the transcript. The chat
    // route maintains the conversationId → sessionId map in BackendState.
    if (request.sessionId) options['resume'] = request.sessionId;

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

    if (message.type === 'system') {
      // The SDK emits one `system` message at the start of each query with
      // `session_id`. Surface it so the chat route can persist it for
      // future-turn rehydration via `resume:`.
      const sysMsg = message as unknown as { session_id?: string };
      if (typeof sysMsg.session_id === 'string' && sysMsg.session_id.length > 0) {
        events.push({ type: 'session-started', sessionId: sysMsg.session_id });
      }
    } else if (message.type === 'assistant') {
      // If the assistant message has an error, emit an error event
      if (message.error) {
        events.push({ type: 'error', message: `SDK error: ${message.error}` });
        return events;
      }
      // Extract text and reasoning ("thinking") blocks from the message content
      for (const block of message.message.content) {
        if (block.type === 'text') {
          events.push({ type: 'text-delta', text: block.text });
        } else if (block.type === 'thinking') {
          events.push({ type: 'reasoning-delta', text: block.thinking });
        } else if (block.type === 'tool_use') {
          events.push({
            type: 'tool-input',
            id: block.id,
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
        events.push({ type: 'reasoning-delta', text: event.delta.thinking });
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
        // SDKResultError — surface the actual subtype + per-error detail so
        // logs show what went wrong (cache_control rejection, max-turns cap,
        // max-budget, retry exhaustion, etc.) instead of an opaque message.
        const errs = (message as { errors?: string[] }).errors ?? [];
        const turns = (message as { num_turns?: number }).num_turns ?? 0;
        const detail = errs.length > 0 ? errs.join('; ') : '(no error detail provided)';
        events.push({
          type: 'error',
          message: `SDK ended with ${message.subtype} after ${turns} turn(s): ${detail}`,
        });
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
              id: tr.tool_use_id,
              // SDK doesn't carry the tool name on tool_result blocks; UIMS
              // only needs `id` to correlate with the prior tool-input event.
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

  /**
   * Plain-prompt fast path — no MCP tools, no canvas framing, no thinking,
   * no session resume. Used by `QaEnricher` and other consumers that need
   * the LLM as a JSON-emitting completion endpoint, not an agent loop.
   */
  private async *queryRaw(
    request: QueryRequest,
    sdkQuery: typeof import('@anthropic-ai/claude-agent-sdk').query,
  ): AsyncIterable<ProviderEvent> {
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

    const options: Record<string, unknown> = {
      ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}),
      settingSources: [],
      enableFileCheckpointing: false,
      forkSession: false,
      agents: {},
      mcpServers: {},
      allowedTools: [],
      disallowedTools: SDK_BUILTIN_TOOLS,
      permissionMode: 'dontAsk' as const,
      maxTurns: 1,
      maxOutputTokens: 4096,
      abortController,
    };
    if (this.config.model) options.model = this.config.model;

    try {
      for await (const message of sdkQuery({ prompt: request.prompt, options })) {
        for (const event of this.mapMessage(message as SDKMessage)) {
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

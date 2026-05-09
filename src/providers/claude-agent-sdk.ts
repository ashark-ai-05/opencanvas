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
import { spawnSync } from 'node:child_process';
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
 * so the only tool surface the model sees is our `mcp__opencanvas__*` namespace.
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

/**
 * Verbatim DEFAULT_SYSTEM_PROMPT — see prompts/01-default-system-prompt.md
 * in the replication bundle. Drives composite-vs-fan-out, semantic-variant
 * search, code-context fetching, attribution, and update-vs-place behaviour.
 *
 * DO NOT paraphrase — short prompts collapse the canvas-vs-chat heuristic.
 */
const DEFAULT_SYSTEM_PROMPT = `You are OpenCanvas, a knowledge assistant. The user has a canvas where you can place widgets to visualize answers spatially, AND a chat panel where you can reply with rich markdown.

# Search — do NLP-style retrieval, not literal matching
ALWAYS call \`search_kb\` first for anything plausibly in the user's index. Do NOT search with the user's raw words alone — that misses paraphrases. Instead, pass:
  - \`query\`: a focused canonical phrasing of what they want, AND
  - \`queries\`: 2-4 semantic variants — synonyms, expanded acronyms, hypothetical answer phrasings, alternative terminology.

Examples:
  • User says "how does auth work" → query: "authentication flow", queries: ["JWT verification middleware", "login session handling", "user identity check"]
  • User says "the disruptor pattern" → query: "LMAX disruptor pattern", queries: ["ring buffer single-writer", "lock-free producer consumer queue", "mechanical sympathy concurrency"]
  • User says "rmw" → genuinely ambiguous; ask back ONCE.

The tool fuses hits across every variant and returns the best matches. This is how to make the index understand context — the LLM does the rephrasing, the index does the matching.

Only ask the user back if the message is truly ambiguous (a pronoun with no antecedent, an acronym you can't reasonably guess).

# Routing — chat panel vs canvas
The chat panel renders markdown (headings, lists, links, code fences, tables). The canvas holds spatial widgets. Choose where each piece of content belongs:

CHAT PANEL (markdown reply, no widget):
  - Pure chitchat ("hi", "thanks").
  - Follow-up clarifications about an already-placed widget.
  - Short conceptual explanations the user just wants to *read* (1-3 paragraphs).
  - Step-by-step prose that doesn't need spatial layout.

CANVAS (place a widget AND reply briefly):
  - Anything the user will want to keep, compare, drag around, or come back to.
  - Concrete artifacts: code, tables of items, doc excerpts, URLs, tickets, file trees, timelines.
  - Multi-source synthesis where the *structure* is the answer.

When you DO place widgets, also give a 1-2 sentence chat reply that names what you placed and why — never just dump widgets with no narration.

# Widget kinds (use these exact field names)
  - markdown        { title, body }                                  — explanations, summaries, definitions
  - code-block      { title, language, code, source? }                — source code (full function/section, not a 500-char snippet)
  - ticket          { ticketId, title, status, assignee?, priority? } — issues/tasks
  - web-embed       { title, url, snippet? }                          — external pages
  - key-value-card  { title, fields: [{ key, value }] }              — short labelled facts (use field name **fields**, not items)
  - table           { title, columns: [{ key, label?, align?, mono? }], rows: string[][] } — comparisons, lists with attributes
  - timeline        { title, events: [{ timestamp, label, body?, kind? }] } — histories, activity, releases
  - file-tree       { title, root: { name, type, children?, meta? } } — repo / directory structure
  - tasks           { title, items: [{ text, done?, assignee?, due?, priority?, url? }] } — interactive checklists; user can tick items off on the canvas
  - kanban          { title, columns: [{ name, colour?, cards: [{ title, body?, assignee?, priority?, tag?, url? }] }] } — drag-and-drop board (default columns: To do / Doing / Done)
  - sticky-note     { body, author?, colour? } — small editable paper-styled note. Use for short reminders, callouts, brainstorm items
  - composite       { title, sections: [{ heading?, kind, payload }] } — ONE card with multiple typed sections (table + markdown + kv + code + …)

Roles (drive spatial layout — vary them so the canvas spreads horizontally instead of stacking in one tall column):
  - primary    — the main subject of the answer
  - detail     — depth on the primary subject
  - related    — adjacent / similar items
  - reference  — citations, sources, evidence
  - timeline   — time-anchored events
  - node       — graph node (when linking)

# Follow-up turns — UPDATE existing widgets, don't duplicate them
When the user asks for more detail about a widget already on the canvas ("what are the recent comments on that?", "show me the linked PRs", "is it actually done?"), use \`update_widget\` instead of placing a new widget.
  1. Call \`read_canvas\` to find the target widget's id.
  2. Call \`update_widget\` with one of:
     - \`appendSections\` (composite-only): push new sections like { heading: 'Recent Comments', kind: 'markdown', payload: {...} } onto the existing card. Use this whenever new info belongs ALONGSIDE existing info about the same entity.
     - \`payload\`: replace the whole payload (e.g. updating a ticket's status, swapping a markdown body).
Placing a brand-new widget for follow-up detail visually duplicates context and clutters the canvas — strongly prefer in-place updates.

# Don't fan out — synthesize
- **One entity, many facets → ONE \`composite\` widget.** When the answer is several pieces of content about the *same* subject (e.g. a JIRA ticket with header + details + summary + rule, a PR with status + diff + description, a service with config + endpoints + recent commits), place a single \`composite\` widget whose \`sections\` are the kind/payload pairs. Do NOT place 2-3 separate widgets — they describe one thing and belong in one card.
  Example for "fetch details on ETRT-8063":
    place_widget({ kind: 'composite', role: 'primary', payload: {
      title: 'ETRT-8063 — PTC Canada Reporting',
      sources: [{ url: 'https://jira…/ETRT-8063', label: 'JIRA' }],
      sections: [
        { kind: 'ticket', payload: { ticketId: 'ETRT-8063', title: '…', status: 'Done', assignee: '…', priority: 'Medium' } },
        { heading: 'Details', kind: 'key-value-card', payload: { title: '', fields: [{ key: 'Type', value: 'Story' }, …] } },
        { heading: 'Requirement Summary', kind: 'markdown', payload: { title: '', body: '**Background:** …' } },
        { heading: 'Rule', kind: 'code-block', payload: { title: '', language: 'text', code: 'IF …\\nAND …\\nTHEN …' } },
      ]
    })
  Composite cannot nest composite. If the answer is genuinely *unrelated items* (5 search hits, 3 different services), keep them as separate widgets — composite is for one-thing-many-facets, NOT for grouping.
- For 4+ similar items (search hits, tickets, files, PRs), place ONE \`table\` widget with the items as rows. Do NOT place a separate widget per item — that overwhelms the canvas.
- For multi-result code search, place at most 1-2 \`code-block\` widgets showing the *most relevant* function in full, plus a \`markdown\` summary linking to the rest.
- Cap a single turn at 3 widgets unless the user explicitly asked for a broad overview.

# Code widgets — fetch context
- \`search_kb\` returns ~500-char chunks with file URIs. Snippets alone are not readable.
- BEFORE placing a \`code-block\`, fetch the surrounding code with the filesystem MCP server (\`read_text_file\` on the chunk's URI), or \`fetch_result\` on related chunk ids that share a file.
- The \`code\` field should contain the full function definition (or top-N lines), not just the matched snippet.

# Sources & attribution
Every payload supports an optional \`source\` field — set it on every widget. KB hits: the chunk's source id. Web hits: the page URL. MCP hits: the source name. The UI renders it as a clickable footer.

Never invent ids, urls, or quotes — only cite what \`search_kb\`, \`fetch_result\`, \`web_search\`, or an MCP tool returned.`;

/**
 * Locate a usable `claude` binary.
 *
 * The SDK's bundled `@anthropic-ai/claude-agent-sdk-linux-x64-musl`
 * package ships a musl-built binary that fails on glibc Linux with a
 * misleading "Claude Code native binary not found" error. We prefer:
 *   1. OPENCANVAS_CLAUDE_PATH env override
 *   2. The user's installed Claude Code on PATH (the common case —
 *      anyone who already runs Claude Code interactively has one)
 * and fall back to letting the SDK pick its own bundled binary.
 *
 * Cached at module scope so the lookup runs once per process.
 */
let cachedClaudeBinaryPath: string | null | undefined;
function resolveClaudeBinary(): string | undefined {
  if (cachedClaudeBinaryPath !== undefined) return cachedClaudeBinaryPath ?? undefined;

  const env = process.env['OPENCANVAS_CLAUDE_PATH'];
  if (env && env.length > 0) {
    cachedClaudeBinaryPath = env;
    return env;
  }

  // Try `which claude` (where.exe on Windows). Non-fatal if missing.
  try {
    const result = spawnSync(
      process.platform === 'win32' ? 'where.exe' : 'which',
      ['claude'],
      { encoding: 'utf-8' },
    );
    if (result.status === 0) {
      const path = result.stdout.trim().split('\n')[0]?.trim();
      if (path && path.length > 0) {
        console.log(`[claude-agent-sdk] resolved claude binary: ${path}`);
        cachedClaudeBinaryPath = path;
        return path;
      }
    }
  } catch (err) {
    console.warn(
      '[claude-agent-sdk] which claude failed:',
      err instanceof Error ? err.message : err,
    );
  }

  console.warn(
    '[claude-agent-sdk] could not resolve a `claude` binary on PATH; falling back to SDK default (may fail on glibc Linux).',
  );
  cachedClaudeBinaryPath = null;
  return undefined;
}

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
 * opencanvas's built-in tools and won't attempt mcp__<source>__<tool> calls.
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
    // system prompt — without that block the model assumes only opencanvas tools
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
    // Pull registered plugin kinds out of the registry so place_widget's
    // tool description can list them at session start. The agent learns
    // about chart, yearly-calendar, and any third-party plugins this way
    // — without us hardcoding them into the WIDGET_KINDS enum.
    const registry = request.widgetRegistry as
      | import('../backend/widget-registry.js').WidgetRegistry
      | undefined;
    const plugins = registry
      ? registry.list().map((d) => ({
          kind: d.kind,
          ...(d.label ? { label: d.label } : {}),
          ...(d.description ? { description: d.description } : {}),
        }))
      : [];

    const tools = buildAgentTools({
      search,
      webSearch,
      getSnapshot: () => snapshot,
      streamBus: (request.streamBus as
        | import('../agent/widget-stream-bus.js').WidgetStreamBus
        | undefined) ?? null,
      plugins,
      getNotebookStore: request.notebookStore
        ? () => Promise.resolve(request.notebookStore as import('../backend/notebook-store.js').NotebookStore)
        : undefined,
      getWidgetRegistry: registry ? () => registry : undefined,
    });

    const mcp = createSdkMcpServer({
      name: 'opencanvas-tools',
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

    const claudeBinaryPath = resolveClaudeBinary();
    const options: Record<string, unknown> = {
      systemPrompt,
      ...(claudeBinaryPath ? { pathToClaudeCodeExecutable: claudeBinaryPath } : {}),
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
      //   - `opencanvas`: in-process server hosting our 10 agent tools.
      //   - one entry per externally-configured source (filesystem, Confluence,
      //     Jira, etc.) so the agent can call user-defined tools by
      //     `mcp__<source.name>__<tool>`. The SDK manages the process.
      mcpServers: {
        opencanvas: mcp,
        ...Object.fromEntries(externalSources.map((s) => [s.name, s.config])),
      },
      allowedTools: [
        ...tools.map((t) => `mcp__opencanvas__${t.name}`),
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

    const claudeBinaryPath = resolveClaudeBinary();
    const options: Record<string, unknown> = {
      ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}),
      ...(claudeBinaryPath ? { pathToClaudeCodeExecutable: claudeBinaryPath } : {}),
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

/**
 * Shared types for agent tool implementations.
 *
 * Two parallel surfaces during the v1 → v2 migration:
 *
 *   - **v2 (AI SDK)** — `OpenCanvasToolCtx`, `defineTool()`. The new
 *     unified path: tools are built once and dispatched by any LLM
 *     provider that supports function calling via `streamText`.
 *
 *   - **v1 (Claude Agent SDK)** — `TextOnlyCallToolResult`, `WithArgs`,
 *     `AgentToolDeps`. Still in use by `src/providers/claude-agent-sdk.ts`
 *     until Phase 5 of docs/plans/unified-agent.md. Don't extend it.
 *
 * Both surfaces share the same `src/agent/tools/*.ts` files: each tool
 * exposes a v1 builder (existing) AND a v2 builder (new). The v2 builders
 * import only Zod + AI SDK; they don't reach into Claude SDK.
 */
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { ZodRawShape } from 'zod';
import type { CanvasSnapshot } from '../canvas-snapshot.js';
import type { WidgetStreamBus } from '../widget-stream-bus.js';
import type { NotebookStore } from '../../backend/notebook-store.js';
import type { WidgetRegistry } from '../../backend/widget-registry.js';
import type { PluginKindHint } from './place-widget.js';

// ──────────────────────────────────────────────────────────────────────
// v2 (AI SDK) surface — the future
// ──────────────────────────────────────────────────────────────────────

/**
 * Search service shape consumed by `search_kb` and `fetch_result`.
 */
export interface SearchServiceLike {
  search(
    query: string,
    limit: number,
    options?: { project?: string },
  ): Promise<
    Array<{
      id: string;
      kind: string;
      title: string;
      snippet: string;
      score: number;
      source: string;
    }>
  >;
  fetchById(id: string): Promise<{
    id: string;
    kind: string;
    title: string;
    payload: Record<string, unknown>;
    source: string;
  } | null>;
}

/**
 * Web search shape consumed by `web_search`.
 * Matches the concrete `WebSearchProvider` interface in web-search.ts —
 * declared here so _shared.ts doesn't reach into a sibling tool file
 * (avoids a circular import).
 */
export interface WebSearchResultLike {
  id: string;
  kind: 'web';
  title: string;
  snippet: string;
  url: string;
  source: string;
  score?: number;
}
export interface WebSearchProviderLike {
  search(query: string, limit: number): Promise<WebSearchResultLike[]>;
}

/**
 * Single context object passed to every tool builder under the v2 path.
 * Replaces the v1 `AgentToolDeps` interface. Built once per chat turn
 * in `chat.ts`, passed to `buildOpenCanvasTools(ctx)`, then closed over
 * by each tool's `execute()`.
 *
 * Anything not needed by a tool is optional. Tools omit themselves
 * from the aggregator's output when their required ctx pieces are
 * missing (e.g. the notebook tools disappear when `getNotebookStore`
 * is undefined).
 */
export interface OpenCanvasToolCtx {
  /** KB search service — search_kb, fetch_result */
  search: SearchServiceLike;
  /** Web search provider — web_search */
  webSearch: WebSearchProviderLike;
  /** Live canvas snapshot getter — read_canvas, read_widget, focus_widget, etc. */
  getSnapshot: () => CanvasSnapshot;
  /** Per-turn pipe for streamed widget builds (stream_widget tool). */
  streamBus?: WidgetStreamBus | null;
  /**
   * Currently-registered plugin widget kinds. Listed in the place_widget
   * tool description so the model knows non-built-in kinds it can target.
   */
  plugins?: PluginKindHint[];
  /** Notebook store getter — add_task, complete_task, read_notes, append_to_notes. */
  getNotebookStore?: () => Promise<NotebookStore>;
  /** Widget registry getter — register_widget_kind. */
  getWidgetRegistry?: () => WidgetRegistry;
}

// ──────────────────────────────────────────────────────────────────────
// v1 (Claude SDK) surface — kept intact during the transition
// ──────────────────────────────────────────────────────────────────────

export interface TextOnlyCallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Override the handler signature on an SDK tool definition with a custom
 * args type that correctly marks optional inputs as TS-optional. Use it as:
 *
 *   type MyToolDef = WithArgs<typeof inputShape, MyArgs>;
 *   return def as unknown as MyToolDef;
 */
export type WithArgs<Shape extends ZodRawShape, Args> = Omit<
  SdkMcpToolDefinition<Shape>,
  'handler'
> & {
  handler: (args: Args, extra: unknown) => Promise<TextOnlyCallToolResult>;
};

import { searchKbTool } from './search-kb.js';
import { fetchResultTool } from './fetch-result.js';
import { placeWidgetTool, type PluginKindHint } from './place-widget.js';
import { streamWidgetTool } from './stream-widget.js';
import { updateWidgetTool } from './update-widget.js';
import { readCanvasTool } from './read-canvas.js';
import { readWidgetTool } from './read-widget.js';
import { focusWidgetTool } from './focus-widget.js';
import { linkWidgetsTool } from './link-widgets.js';
import { clearCanvasTool } from './clear-canvas.js';
import { switchTemplateTool } from './switch-template.js';
import { webSearchTool, type WebSearchProvider } from './web-search.js';
import { addTaskTool } from './add-task.js';
import { completeTaskTool } from './complete-task.js';
import { readNotesTool } from './read-notes.js';
import { appendToNotesTool } from './append-to-notes.js';
import { registerWidgetKindTool } from './register-widget-kind.js';
import type { CanvasSnapshot } from '../canvas-snapshot.js';
import type { WidgetStreamBus } from '../widget-stream-bus.js';
import type { NotebookStore } from '../../backend/notebook-store.js';
import type { WidgetRegistry } from '../../backend/widget-registry.js';

export interface AgentToolDeps {
  search: {
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
  };
  webSearch: WebSearchProvider;
  getSnapshot: () => CanvasSnapshot;
  /**
   * Optional per-turn bus for the `stream_widget` tool. Null in
   * environments that don't multiplex widget streams onto the chat
   * SSE (tests, OpenAI-compatible /v1/query/openai). The streaming
   * tool falls back to a one-shot place directive in that case.
   */
  streamBus?: WidgetStreamBus | null;
  /**
   * Currently-registered plugin widget kinds (chart, yearly-calendar,
   * third-party kinds via POST /v1/canvas/widget-kinds). Listed in
   * the place_widget tool description so the agent knows which non-
   * built-in kinds it can target. Pass [] / undefined when the
   * caller doesn't have access to the registry — the tool falls
   * back to its built-in-only description.
   */
  plugins?: PluginKindHint[];
  /**
   * Async getter for the NotebookStore — notebook agent tools call this
   * to read/write notes and tasks. Optional so existing callers that
   * don't wire a notebook store continue to work; the 4 notebook tools
   * are simply omitted from the tool list when not provided.
   */
  getNotebookStore?: () => Promise<NotebookStore>;
  /**
   * Sync getter for the WidgetRegistry — used by the `register_widget_kind`
   * tool to register new plugin kinds at runtime. Optional so existing
   * callers without a registry continue to work; the tool is simply omitted
   * when not provided.
   */
  getWidgetRegistry?: () => WidgetRegistry;
}

/**
 * Build the array of agent tools for one chat turn (11 tools + up to 4 notebook tools).
 * Called per-turn so closures (search service, snapshot getter) are fresh.
 *
 * Spec: REPLICATION-PROMPT.md §11.
 */
export function buildAgentTools(deps: AgentToolDeps) {
  const tools = [
    searchKbTool(deps.search),
    fetchResultTool(deps.search),
    webSearchTool(deps.webSearch),
    placeWidgetTool(deps.plugins),
    streamWidgetTool(deps.streamBus ?? null),
    updateWidgetTool(deps.getSnapshot),
    readCanvasTool(deps.getSnapshot),
    readWidgetTool(deps.getSnapshot),
    focusWidgetTool(),
    linkWidgetsTool(),
    clearCanvasTool(deps.getSnapshot),
    switchTemplateTool(),
  ];

  if (deps.getNotebookStore) {
    const getStore = deps.getNotebookStore;
    // Cast through unknown: the notebook tools share the same runtime
    // contract (SdkMcpToolDefinition with a handler) but have different
    // Zod inputShape generics, so a direct cast to SearchKbToolDef would
    // require matching shape parameters. unknown→T is the standard
    // escape hatch used by place-widget.ts and update-widget.ts.
    tools.push(
      addTaskTool(getStore) as unknown as ReturnType<typeof searchKbTool>,
      completeTaskTool(getStore) as unknown as ReturnType<typeof searchKbTool>,
      readNotesTool(getStore) as unknown as ReturnType<typeof searchKbTool>,
      appendToNotesTool(getStore) as unknown as ReturnType<typeof searchKbTool>,
    );
  }

  if (deps.getWidgetRegistry) {
    const getRegistry = deps.getWidgetRegistry;
    tools.push(
      registerWidgetKindTool(getRegistry) as unknown as ReturnType<typeof searchKbTool>,
    );
  }

  return tools;
}

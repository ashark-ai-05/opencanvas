import { searchKbTool, searchKbToolV2 } from './search-kb.js';
import { fetchResultTool, fetchResultToolV2 } from './fetch-result.js';
import { placeWidgetTool, placeWidgetToolV2, type PluginKindHint } from './place-widget.js';
import { streamWidgetTool, streamWidgetToolV2 } from './stream-widget.js';
import { updateWidgetTool, updateWidgetToolV2 } from './update-widget.js';
import { readCanvasTool, readCanvasToolV2 } from './read-canvas.js';
import { readWidgetTool, readWidgetToolV2 } from './read-widget.js';
import { focusWidgetTool, focusWidgetToolV2 } from './focus-widget.js';
import { linkWidgetsTool, linkWidgetsToolV2 } from './link-widgets.js';
import { clearCanvasTool, clearCanvasToolV2 } from './clear-canvas.js';
import { switchTemplateTool, switchTemplateToolV2 } from './switch-template.js';
import { webSearchTool, webSearchToolV2, type WebSearchProvider } from './web-search.js';
import { addTaskTool, addTaskToolV2 } from './add-task.js';
import { completeTaskTool, completeTaskToolV2 } from './complete-task.js';
import { readNotesTool, readNotesToolV2 } from './read-notes.js';
import { appendToNotesTool, appendToNotesToolV2 } from './append-to-notes.js';
import { registerWidgetKindTool, registerWidgetKindToolV2 } from './register-widget-kind.js';
import { listTemplatesTool, listTemplatesToolV2 } from './list-templates.js';
import type { CanvasSnapshot } from '../canvas-snapshot.js';
import type { WidgetStreamBus } from '../widget-stream-bus.js';
import type { NotebookStore } from '../../backend/notebook-store.js';
import type { WidgetRegistry } from '../../backend/widget-registry.js';
import type { OpenCanvasToolCtx } from './_shared.js';
import type { Tool } from 'ai';

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

// ─── v2 (AI SDK) — the unified path ─────────────────────────────────────
// See docs/plans/unified-agent.md. Returns a Record<string, Tool> shaped
// for `streamText({ tools: ... })` — the tool name is the dict key,
// matching AI SDK convention. Optional tools (notebook/registry) are
// omitted from the record when their ctx field is missing, so the
// model never sees them and they don't pollute its tool list.
export function buildOpenCanvasTools(
  ctx: OpenCanvasToolCtx,
): Record<string, Tool> {
  const tools: Record<string, Tool> = {
    search_kb:        searchKbToolV2(ctx),
    fetch_result:     fetchResultToolV2(ctx),
    web_search:       webSearchToolV2(ctx),
    place_widget:     placeWidgetToolV2(ctx),
    stream_widget:    streamWidgetToolV2(ctx),
    update_widget:    updateWidgetToolV2(ctx),
    read_canvas:      readCanvasToolV2(ctx),
    read_widget:      readWidgetToolV2(ctx),
    focus_widget:     focusWidgetToolV2(ctx),
    link_widgets:     linkWidgetsToolV2(ctx),
    clear_canvas:     clearCanvasToolV2(ctx),
    switch_template:  switchTemplateToolV2(ctx),
  };

  if (ctx.getNotebookStore) {
    tools['add_task']        = addTaskToolV2(ctx);
    tools['complete_task']   = completeTaskToolV2(ctx);
    tools['read_notes']      = readNotesToolV2(ctx);
    tools['append_to_notes'] = appendToNotesToolV2(ctx);
  }

  if (ctx.getWidgetRegistry) {
    tools['register_widget_kind'] = registerWidgetKindToolV2(ctx);
    tools['list_templates'] = listTemplatesToolV2(ctx);
  }

  return tools;
}

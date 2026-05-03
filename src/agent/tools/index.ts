import { searchKbTool } from './search-kb.js';
import { fetchResultTool } from './fetch-result.js';
import { placeWidgetTool } from './place-widget.js';
import { readCanvasTool } from './read-canvas.js';
import { readWidgetTool } from './read-widget.js';
import { focusWidgetTool } from './focus-widget.js';
import { linkWidgetsTool } from './link-widgets.js';
import { clearCanvasTool } from './clear-canvas.js';
import { switchTemplateTool } from './switch-template.js';
import type { CanvasSnapshot } from '../canvas-snapshot.js';

export interface AgentToolDeps {
  search: {
    search(query: string, limit: number): Promise<
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
  getSnapshot: () => CanvasSnapshot;
}

/**
 * Build the array of 9 tools for one chat turn.
 * Called per-turn so closures (search service, snapshot getter) are fresh.
 */
export function buildAgentTools(deps: AgentToolDeps) {
  return [
    searchKbTool(deps.search),
    fetchResultTool(deps.search),
    placeWidgetTool(),
    readCanvasTool(deps.getSnapshot),
    readWidgetTool(deps.getSnapshot),
    focusWidgetTool(),
    linkWidgetsTool(),
    clearCanvasTool(deps.getSnapshot),
    switchTemplateTool(),
  ];
}

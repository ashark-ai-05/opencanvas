import type { Editor } from 'tldraw';
import { pickWidgetForKind } from '../../../src/core/widget-registry';
import type { SearchResult } from '../api/search';

const COL_WIDTH = 380;
const ROW_HEIGHT = 240;
const CLUSTER_GAP = 60;

/**
 * Convert a Result.shape (already shaped by the backend) into the props
 * expected by the corresponding ShapeUtil. The widget registry tells us
 * what shapeType to use; this function fills in any defaults the shape
 * declares as required.
 */
function shapeProps(
  shapeType: string,
  result: SearchResult
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...result.shape, uri: result.provenance.uri };

  switch (shapeType) {
    case 'llm-wiki:markdown':
      return { w: 360, h: 240, ...base };
    case 'llm-wiki:code-block':
      return { w: 480, h: 280, ...base };
    case 'llm-wiki:ticket':
      return {
        w: 320,
        h: 200,
        ticketId: result.id,
        title: result.shape['title'] ?? 'Untitled',
        ...base,
      };
    case 'llm-wiki:web-embed':
      return { w: 480, h: 320, url: (result.shape as { url?: string }).url ?? '', ...base };
    case 'llm-wiki:key-value-card':
    default:
      return {
        w: 320,
        h: 200,
        title: (result.shape as { title?: string }).title ?? result.kind,
        pairs: (result.shape as { pairs?: Array<{ key: string; value: string }> }).pairs ?? [],
        ...base,
      };
  }
}

/**
 * Group results by kind, then place each group as a column on the canvas.
 * Origin is the top-left of the current viewport, plus a small inset.
 */
export function placeResultsOnCanvas(
  editor: Editor,
  results: SearchResult[]
): void {
  if (results.length === 0) return;

  const viewport = editor.getViewportPageBounds();
  const originX = viewport.x + 80;
  const originY = viewport.y + 100;

  const byKind = new Map<string, SearchResult[]>();
  for (const r of results) {
    const arr = byKind.get(r.kind) ?? [];
    arr.push(r);
    byKind.set(r.kind, arr);
  }

  let col = 0;
  for (const [, group] of byKind) {
    let row = 0;
    for (const r of group) {
      const widget = pickWidgetForKind(r.kind);
      const props = shapeProps(widget.shapeType, r);
      editor.createShape({
        type: widget.shapeType,
        x: originX + col * (COL_WIDTH + CLUSTER_GAP),
        y: originY + row * (ROW_HEIGHT + 20),
        props,
      });
      row++;
    }
    col++;
  }
}

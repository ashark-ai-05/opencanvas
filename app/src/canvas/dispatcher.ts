import type { Editor } from 'tldraw';
import type { SearchResult } from '../api/search';
import { TEMPLATES_BY_ID } from './templates';
import { useTemplateStore } from '../state/template-store';
import type { ToolDirective, TemplateId, WidgetKind } from '../../../src/agent/types';

/**
 * Place results on the canvas using the active template's layout.
 * The layout function returns ShapePlacement[]; we hand each one to
 * editor.createShape.
 */
export function placeResultsOnCanvas(
  editor: Editor,
  results: SearchResult[]
): void {
  if (results.length === 0) return;

  const { activeTemplateId } = useTemplateStore.getState();
  const template = TEMPLATES_BY_ID[activeTemplateId];
  const placements = template.layout(results, editor.getViewportPageBounds());

  for (const p of placements) {
    editor.createShape({
      type: p.shapeType,
      x: p.x,
      y: p.y,
      props: p.props,
    });
  }
}

const KIND_TO_SHAPE: Record<WidgetKind, string> = {
  markdown: 'strata:markdown',
  'code-block': 'strata:code-block',
  ticket: 'strata:ticket',
  'web-embed': 'strata:web-embed',
  'key-value-card': 'strata:key-value-card',
  table: 'strata:table',
  timeline: 'strata:timeline',
  'file-tree': 'strata:file-tree',
};

/** Sensible default size per kind so wide tables don't get cropped at 320×200. */
const DEFAULT_SIZE: Record<WidgetKind, { w: number; h: number }> = {
  markdown: { w: 360, h: 240 },
  'code-block': { w: 480, h: 280 },
  ticket: { w: 320, h: 200 },
  'web-embed': { w: 420, h: 200 },
  'key-value-card': { w: 320, h: 220 },
  table: { w: 520, h: 280 },
  timeline: { w: 400, h: 320 },
  'file-tree': { w: 360, h: 360 },
};

/**
 * Apply a directive coming from a backend tool to the tldraw editor.
 * `templateId` is the active template at directive-receive time
 * (read from the Zustand template store at the call site).
 */
export function applyToolDirective(
  editor: Editor,
  directive: ToolDirective,
  templateId: TemplateId,
): void {
  switch (directive.type) {
    case 'place': {
      const tpl = TEMPLATES_BY_ID[templateId];
      if (!tpl) throw new Error(`unknown template: ${templateId}`);
      const occupancy = countByRole(editor, directive.role);
      const slot = tpl.slotForRole(
        directive.role,
        occupancy,
        editor.getViewportPageBounds(),
      );
      // Take the larger of (template slot) and (per-kind default) for each
      // dimension — keeps wide widgets like table/file-tree from being
      // clipped while still respecting the template's spatial intent.
      const def = DEFAULT_SIZE[directive.kind] ?? { w: 320, h: 200 };
      const w = Math.max(slot.w, def.w);
      const h = Math.max(slot.h, def.h);
      editor.createShape({
        id: ('shape:' + directive.id) as never,
        type: KIND_TO_SHAPE[directive.kind] as never,
        x: slot.x,
        y: slot.y,
        meta: { role: directive.role } as never,
        props: { ...directive.payload, w, h } as never,
      } as never);
      return;
    }
    case 'clear': {
      const ids = editor
        .getCurrentPageShapes()
        .filter((s) => s.type.startsWith('strata:'))
        .map((s) => s.id);
      if (ids.length > 0) editor.deleteShapes(ids as never[]);
      return;
    }
    case 'switchTemplate': {
      useTemplateStore.getState().setActiveTemplateId(directive.id);
      return;
    }
    case 'focus': {
      const shape = editor.getShape(('shape:' + directive.id) as never);
      if (!shape) throw new Error(`shape not found for id: ${directive.id}`);
      const sx = (shape as { x: number }).x;
      const sy = (shape as { y: number }).y;
      const sw = (shape as { props: { w?: number } }).props.w ?? 320;
      const sh = (shape as { props: { h?: number } }).props.h ?? 200;
      editor.zoomToBounds({ x: sx, y: sy, w: sw, h: sh } as never, {
        inset: 80,
        animation: { duration: 200 },
      } as never);
      return;
    }
    case 'link': {
      const from = editor.getShape(('shape:' + directive.fromId) as never);
      const to = editor.getShape(('shape:' + directive.toId) as never);
      if (!from || !to) {
        throw new Error(
          `link: missing shape (from=${directive.fromId}, to=${directive.toId})`,
        );
      }
      const fx =
        (from as { x: number }).x +
        ((from as { props: { w?: number } }).props.w ?? 320) / 2;
      const fy =
        (from as { y: number }).y +
        ((from as { props: { h?: number } }).props.h ?? 200) / 2;
      const tx =
        (to as { x: number }).x +
        ((to as { props: { w?: number } }).props.w ?? 320) / 2;
      const ty =
        (to as { y: number }).y +
        ((to as { props: { h?: number } }).props.h ?? 200) / 2;
      editor.createShape({
        id: ('shape:' + directive.linkId) as never,
        type: 'arrow',
        x: 0,
        y: 0,
        props: {
          start: { x: fx, y: fy },
          end: { x: tx, y: ty },
          text: directive.label ?? '',
        } as never,
      } as never);
      return;
    }
    default:
      // All directive types are implemented; this branch guards against
      // unknown future types added to the union without a matching case.
      throw new Error(
        `applyToolDirective: unknown directive type "${(directive as { type: string }).type}"`,
      );
  }
}

function countByRole(editor: Editor, role: string): number {
  const shapes = editor.getCurrentPageShapes() as Array<{
    type: string;
    meta?: Record<string, unknown>;
  }>;
  return shapes.filter(
    (s) =>
      s.type.startsWith('strata:') && (s.meta?.['role'] as string) === role,
  ).length;
}

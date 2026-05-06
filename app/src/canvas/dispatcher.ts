import type { Editor } from 'tldraw';
import type { SearchResult } from '../api/search';
import { TEMPLATES_BY_ID } from './templates';
import { useTemplateStore } from '../state/template-store';
import type {
  ToolDirective,
  TemplateId,
  WidgetKind,
  WidgetStreamOp,
} from '../../../src/agent/types';
import { applyOps } from './stream-mutator';

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
  markdown: 'opencanvas:markdown',
  'code-block': 'opencanvas:code-block',
  ticket: 'opencanvas:ticket',
  'web-embed': 'opencanvas:web-embed',
  'key-value-card': 'opencanvas:key-value-card',
  table: 'opencanvas:table',
  timeline: 'opencanvas:timeline',
  'file-tree': 'opencanvas:file-tree',
  composite: 'opencanvas:composite',
  tasks: 'opencanvas:tasks',
  kanban: 'opencanvas:kanban',
  'sticky-note': 'opencanvas:sticky-note',
  generic: 'opencanvas:generic',
};

/** Sensible default size per kind so wide tables don't get cropped at 320×200. */
const DEFAULT_SIZE: Record<WidgetKind, { w: number; h: number }> = {
  markdown: { w: 320, h: 180 },
  'code-block': { w: 420, h: 220 },
  ticket: { w: 280, h: 150 },
  'web-embed': { w: 360, h: 160 },
  'key-value-card': { w: 280, h: 170 },
  table: { w: 520, h: 240 },
  timeline: { w: 360, h: 280 },
  'file-tree': { w: 320, h: 300 },
  composite: { w: 480, h: 480 },
  tasks: { w: 320, h: 260 },
  kanban: { w: 720, h: 360 },
  'sticky-note': { w: 200, h: 200 },
  generic: { w: 420, h: 320 },
};

/**
 * After this many opencanvas widgets are on the canvas, new placements start
 * collapsed so dense canvases don't visually overflow. Spec §12.
 */
const COLLAPSE_THRESHOLD = 3;

/**
 * Per-widget streaming state.
 *  - lastSeq:    sequence number of the most recently APPLIED op
 *  - pending:    ops queued for the next animation frame, in arrival order
 *  - rafHandle:  outstanding requestAnimationFrame handle, if any
 *
 * Buffering rationale: when streamed text deltas arrive at 30+/sec the
 * dispatcher would otherwise issue 30+ tldraw updateShape calls per
 * second. Coalescing per-frame keeps tldraw history clean (one entry
 * per frame) and avoids React render thrash.
 */
type StreamState = {
  lastSeq: number;
  pending: WidgetStreamOp[];
  rafHandle: number | null;
};
const streams = new Map<string, StreamState>();

function ensureStream(id: string): StreamState {
  let s = streams.get(id);
  if (!s) {
    s = { lastSeq: 0, pending: [], rafHandle: null };
    streams.set(id, s);
  }
  return s;
}

function flushStream(editor: Editor, id: string): void {
  const s = streams.get(id);
  if (!s || s.pending.length === 0) return;
  const ops = s.pending;
  s.pending = [];
  s.rafHandle = null;

  const shapeId = ('shape:' + id) as never;
  const target = editor.getShape(shapeId) as
    | { type: string; props: Record<string, unknown> }
    | undefined;
  if (!target) {
    // Shape was deleted mid-stream (user dismissed the card). Drop ops
    // silently — no canvas to mutate.
    return;
  }

  const nextProps = applyOps(target.props, ops);
  if (!nextProps) return;

  editor.batch(() => {
    editor.updateShape({
      id: shapeId,
      type: target.type as never,
      props: nextProps as never,
    } as never);
  });
}

function scheduleFlush(editor: Editor, id: string): void {
  const s = ensureStream(id);
  if (s.rafHandle !== null) return;
  s.rafHandle = requestAnimationFrame(() => flushStream(editor, id));
}

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

      // Resolve overlap with already-placed opencanvas widgets. Templates are
      // role-aware but blind to actual canvas state — when the agent fans
      // out across roles in quick succession, slots calculated from
      // occupancy can collide with adjacent roles' slots OR with shapes
      // the user moved manually. Sweep down/right until we find an empty
      // spot near the template's preferred position.
      const { x, y } = findFreePosition(editor, slot.x, slot.y, w, h);

      const totalOpenCanvas = editor
        .getCurrentPageShapes()
        .filter((s) => s.type.startsWith('opencanvas:')).length;
      const startCollapsed = totalOpenCanvas >= COLLAPSE_THRESHOLD;

      // sources / sourceLabel: peeled into `meta` so the shape props stay
      // payload-pure. CardFrame reads either `props.sources` or
      // `meta.sources` (we keep both for backwards compat with widgets
      // saved by older builds).
      const meta: Record<string, unknown> = { role: directive.role };
      if (startCollapsed) {
        meta['collapsed'] = true;
        meta['expandedHeight'] = h;
      }

      editor.createShape({
        id: ('shape:' + directive.id) as never,
        type: KIND_TO_SHAPE[directive.kind] as never,
        x,
        y,
        meta: meta as never,
        props: {
          ...directive.payload,
          w,
          h: startCollapsed ? 44 : h,
        } as never,
      } as never);
      return;
    }
    case 'update': {
      const target = editor.getShape(('shape:' + directive.id) as never) as
        | {
            type: string;
            props: { w?: number; h?: number; sections?: unknown[] };
          }
        | undefined;
      if (!target) {
        // Don't throw — the agent may reference an id that's been
        // deleted. Surface in console and bail.
        console.warn(`[dispatcher] update: shape not found for id ${directive.id}`);
        return;
      }

      // appendSections (composite-only): append to props.sections,
      // preserving everything else.
      if (directive.appendSections) {
        const existing = Array.isArray(target.props.sections)
          ? target.props.sections
          : [];
        editor.updateShape({
          id: ('shape:' + directive.id) as never,
          type: target.type as never,
          props: {
            sections: [...existing, ...directive.appendSections],
          } as never,
        } as never);
        return;
      }

      // payload replacement: merge over existing props but preserve w/h
      // (spatial layout is a canvas concern, not a payload concern).
      if (directive.payload) {
        editor.updateShape({
          id: ('shape:' + directive.id) as never,
          type: target.type as never,
          props: {
            ...directive.payload,
            ...(target.props.w !== undefined ? { w: target.props.w } : {}),
            ...(target.props.h !== undefined ? { h: target.props.h } : {}),
          } as never,
        } as never);
      }
      return;
    }
    case 'clear': {
      const ids = editor
        .getCurrentPageShapes()
        .filter((s) => s.type.startsWith('opencanvas:'))
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
    case 'stream-start': {
      // Same placement path as 'place', plus meta.streaming=true so
      // renderers can show streaming-state visuals. Reuses the
      // template's slot resolver and overlap avoidance.
      const tpl = TEMPLATES_BY_ID[templateId];
      if (!tpl) throw new Error(`unknown template: ${templateId}`);
      const occupancy = countByRole(editor, directive.role);
      const slot = tpl.slotForRole(
        directive.role,
        occupancy,
        editor.getViewportPageBounds(),
      );
      const def = DEFAULT_SIZE[directive.kind] ?? { w: 320, h: 200 };
      const w = Math.max(slot.w, def.w);
      const h = Math.max(slot.h, def.h);
      const { x, y } = findFreePosition(editor, slot.x, slot.y, w, h);

      const meta: Record<string, unknown> = {
        role: directive.role,
        streaming: true,
      };
      editor.createShape({
        id: ('shape:' + directive.id) as never,
        type: KIND_TO_SHAPE[directive.kind] as never,
        x,
        y,
        meta: meta as never,
        props: { ...directive.scaffold, w, h } as never,
      } as never);

      // Initialise the per-stream buffer so subsequent ops route here.
      ensureStream(directive.id);
      return;
    }
    case 'stream-op': {
      const s = ensureStream(directive.id);
      // Drop dupes / out-of-order ops. We don't request resync in V1 —
      // UIMS over a single SSE connection is reliable in practice; we'll
      // wire resync when we observe a real gap.
      if (directive.seq <= s.lastSeq) {
        console.warn(
          `[dispatcher] stream-op out-of-order: id=${directive.id} ` +
            `seq=${directive.seq} lastSeq=${s.lastSeq}`,
        );
        return;
      }
      s.lastSeq = directive.seq;
      s.pending.push(directive.op);
      scheduleFlush(editor, directive.id);
      return;
    }
    case 'stream-end': {
      // Flush any pending ops synchronously so the final frame contains
      // everything that arrived before the close.
      flushStream(editor, directive.id);

      const shapeId = ('shape:' + directive.id) as never;
      const shape = editor.getShape(shapeId) as
        | { type: string; meta?: Record<string, unknown> }
        | undefined;
      if (shape) {
        const meta: Record<string, unknown> = { ...(shape.meta ?? {}) };
        meta['streaming'] = false;
        if (!directive.ok) {
          meta['streamingError'] = directive.error ?? 'stream interrupted';
        }
        editor.updateShape({
          id: shapeId,
          type: shape.type as never,
          meta: meta as never,
        } as never);
      }
      streams.delete(directive.id);
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
      s.type.startsWith('opencanvas:') && (s.meta?.['role'] as string) === role,
  ).length;
}

/**
 * Find a placement near (preferX, preferY) that doesn't overlap any
 * existing opencanvas widget. Walks a coarse grid below + right of the
 * template's preferred slot. 16px gap between cards.
 *
 * The search prefers downward motion (continues the visual reading order)
 * with a small rightward drift to avoid forming purely vertical stacks
 * when many widgets share the same role.
 */
const GAP = 16;
function findFreePosition(
  editor: Editor,
  preferX: number,
  preferY: number,
  w: number,
  h: number,
): { x: number; y: number } {
  const placed = (editor.getCurrentPageShapes() as Array<{
    type: string;
    x: number;
    y: number;
    props?: { w?: number; h?: number };
  }>).filter((s) => s.type.startsWith('opencanvas:'));

  const overlaps = (x: number, y: number): boolean => {
    for (const s of placed) {
      const sw = s.props?.w ?? 320;
      const sh = s.props?.h ?? 200;
      // Treat existing card's bounds with a GAP-sized buffer so cards
      // don't end up touching pixel-perfect.
      const sx1 = s.x - GAP;
      const sy1 = s.y - GAP;
      const sx2 = s.x + sw + GAP;
      const sy2 = s.y + sh + GAP;
      const cx1 = x;
      const cy1 = y;
      const cx2 = x + w;
      const cy2 = y + h;
      if (cx1 < sx2 && cx2 > sx1 && cy1 < sy2 && cy2 > sy1) return true;
    }
    return false;
  };

  if (!overlaps(preferX, preferY)) return { x: preferX, y: preferY };

  // Walk down in steps of (h + GAP); after each row, drift right by a
  // half-card width so we don't end up with all collisions stacking
  // vertically. Cap iterations so a pathological canvas doesn't loop.
  for (let row = 1; row < 30; row++) {
    const y = preferY + row * (h + GAP);
    const x = preferX + Math.floor(row / 4) * (w / 2);
    if (!overlaps(x, y)) return { x, y };
  }

  // Last resort — far below the canvas. User can rearrange.
  return { x: preferX, y: preferY + 30 * (h + GAP) };
}

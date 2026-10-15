/**
 * Shared canvas tidy. Used by `/tidy`, the welcome-seed settle, the
 * once-per-fresh-canvas auto-tidy after the first few user widgets, and
 * soft re-tidy when the canvas grows again after that.
 *
 * Places every opencanvas widget into a chat-aware wrap grid (or the
 * active template's role slots as a fallback). Optionally zooms to fit.
 */
import type { Editor } from 'tldraw';
import { toast } from 'sonner';
import { STAR_NUDGE_EVENT } from '../state/star-nudge-store';
import { TEMPLATES_BY_ID } from './templates';
import { placementBounds } from './dispatcher';
import { useTemplateStore } from '../state/template-store';

const ROLE_ORDER = [
  'primary',
  'detail',
  'related',
  'reference',
  'timeline',
  'node',
] as const;

const AUTO_TIDY_FLAG = 'opencanvas:auto-tidied:v1';
const LAST_TIDY_COUNT_KEY = 'opencanvas:last-tidy-count:v1';
/** After the first auto-tidy, re-tidy when the canvas grows by this many. */
export const SOFT_RETIDY_GROWTH = 4;

/**
 * True when the user is editing text, pointing, or dragging — soft
 * re-tidy must not yank a card out from under their cursor.
 */
export function isCanvasBusy(editor: Editor): boolean {
  try {
    const ed = editor as unknown as {
      getEditingShapeId?: () => string | null;
      inputs?: { isDragging?: boolean; isPointing?: boolean };
    };
    if (ed.getEditingShapeId?.()) return true;
    if (ed.inputs?.isDragging) return true;
    // Pointing with a selection usually means a drag is about to start
    // or is in progress below the distance threshold.
    if (ed.inputs?.isPointing) {
      const ids = (
        editor as unknown as { getSelectedShapeIds?: () => string[] }
      ).getSelectedShapeIds?.() ?? [];
      if (ids.length > 0) return true;
    }
  } catch {
    /* probing must never break tidy */
  }
  return false;
}

/** Ask the UI to show the once-per-browser star nudge (best-effort). */
export function offerStarNudge(): void {
  try {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(STAR_NUDGE_EVENT));
  } catch {
    /* ignore */
  }
}

/** Kinds that need a full grid row so columns/headers stay readable. */
const WIDE_TYPES = new Set([
  'opencanvas:table',
  'opencanvas:kanban',
  'opencanvas:composite',
  'opencanvas:code-block',
  'opencanvas:file-tree',
]);

export type TidyOptions = {
  /** Animate into slots (default true). */
  animate?: boolean;
  /** After laying out, zoom the viewport to fit (default false). */
  zoomToFit?: boolean;
  /** Only rearrange shapes whose ids are in this set. */
  onlyIds?: Set<string>;
  /** Force the wrap-grid layout even when role columns would fit. */
  forceGrid?: boolean;
  /** Zoom to fit only if the tidied grid overflows the viewport. */
  fitIfOverflow?: boolean;
};

function usableScreenWidth(editor: Editor): number {
  let usableScreenW = 1000;
  try {
    if (typeof document === 'undefined') return usableScreenW;
    const screen = (
      editor as unknown as {
        getViewportScreenBounds?: () => { w: number };
      }
    ).getViewportScreenBounds?.();
    if (screen && screen.w > 0) {
      usableScreenW = screen.w;
      const chat = document.querySelector('.opencanvas-chat-floating');
      if (chat && chat.getAttribute('data-mode') !== 'minimized') {
        const left = chat.getBoundingClientRect().left;
        if (left > screen.w * 0.45) usableScreenW = left - 24;
      }
    }
  } catch {
    /* probing must never break tidy */
  }
  return usableScreenW;
}

/**
 * zoomToFit, but framed into the area left of the floating chat so the
 * right-hand column isn't hidden under the panel. Falls back to plain
 * zoomToFit when there's no chat or bounds aren't available.
 */
function fitLeftOfChat(editor: Editor): void {
  try {
    const ed = editor as unknown as {
      getCurrentPageBounds?: () => { x: number; y: number; w: number; h: number } | undefined;
      getViewportScreenBounds?: () => { w: number };
      zoomToBounds?: (
        b: { x: number; y: number; w: number; h: number },
        o: { animation: { duration: number }; inset?: number; targetZoom?: number },
      ) => void;
      zoomToFit?: (o: { animation: { duration: number } }) => void;
    };
    const bounds = ed.getCurrentPageBounds?.();
    const screen = ed.getViewportScreenBounds?.();
    const usable = usableScreenWidth(editor);
    if (!bounds || !screen || !ed.zoomToBounds || screen.w <= 0) {
      ed.zoomToFit?.({ animation: { duration: 280 } });
      return;
    }
    const ratio = Math.min(1, Math.max(0.45, usable / screen.w));
    // Widen the target box on the right by the chat's share of the
    // screen; the real content then lands in the usable left part.
    const padded = {
      x: bounds.x,
      y: bounds.y,
      w: bounds.w / ratio,
      h: bounds.h,
    };
    ed.zoomToBounds(padded, { animation: { duration: 280 }, inset: 48 });
  } catch {
    /* editor torn down */
  }
}

function readLastTidyCount(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const n = Number(localStorage.getItem(LAST_TIDY_COUNT_KEY) ?? '0');
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeTidyBookmark(count: number): void {
  try {
    localStorage.setItem(LAST_TIDY_COUNT_KEY, String(count));
  } catch {
    /* private browsing */
  }
}

export function tidyCanvas(editor: Editor, opts: TidyOptions = {}): number {
  const animate = opts.animate !== false;
  const tplId = useTemplateStore.getState().activeTemplateId;
  const tpl = TEMPLATES_BY_ID[tplId];
  if (!tpl) return 0;

  const viewport = placementBounds(editor);
  const shapes = (
    editor.getCurrentPageShapes() as Array<{
      id: string;
      type: string;
      meta?: Record<string, unknown>;
      x: number;
      y: number;
      props?: { w?: number; h?: number };
    }>
  ).filter(
    (s) =>
      s.type.startsWith('opencanvas:') &&
      (!opts.onlyIds || opts.onlyIds.has(s.id)),
  );
  if (shapes.length === 0) return 0;

  const colGap = 28;
  const rowGap = 20;
  const usableScreenW = usableScreenWidth(editor);

  // Prefer 2 columns for a handful of cards (avoids the sticky-under-chat
  // problem); denser canvases go to 3. Card width grows with the screen so
  // a 2-col layout on a 1440px window gets ~400px cards, not a squeezed 320.
  const desiredCols =
    shapes.length <= 2 ? Math.max(1, shapes.length) : shapes.length <= 6 ? 2 : 3;
  const targetColW = desiredCols <= 2 ? 400 : 320;
  // Screen only caps columns on genuinely narrow windows; on desktop the
  // grid is framed by zoomToFit, so a 10-widget canvas goes 3-wide (a
  // squat block that frames at ~70%) instead of a 2-wide tower at ~48%.
  const colsFromScreen =
    usableScreenW < 560 ? 1 : usableScreenW < 820 ? 2 : 3;
  void targetColW;
  const colsThatFit = Math.max(1, Math.min(desiredCols, colsFromScreen));
  const colW = colsThatFit <= 2 ? 400 : 340;
  const gridTotalW = colsThatFit * colW + (colsThatFit - 1) * colGap;
  const useGrid = opts.forceGrid === true || colsFromScreen < 2;

  // Wide widgets (tables, kanban…) after regular cards so a full-row
  // table doesn't leave a hole in the first columns.
  const ordered = [...shapes].sort((a, b) => {
    const aw = WIDE_TYPES.has(a.type) ? 1 : 0;
    const bw = WIDE_TYPES.has(b.type) ? 1 : 0;
    return aw - bw;
  });

  const positions = new Map<string, { x: number; y: number; w?: number }>();
  if (useGrid) {
    let col = 0;
    let row = 0;
    const originX = viewport.x + 24;
    const originY = viewport.y + 24;
    const rowHeights: number[] = [];
    for (const shape of ordered) {
      const h = shape.props?.h ?? 200;
      const wide = WIDE_TYPES.has(shape.type);
      const span = wide ? colsThatFit : 1;
      if (col + span > colsThatFit) {
        col = 0;
        row += 1;
      }
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, h);
      const y =
        originY +
        rowHeights.slice(0, row).reduce((a, b) => a + b + rowGap, 0);
      const natural = shape.props?.w ?? (wide ? 520 : colW);
      // Wide cards take the whole row so table columns get real room.
      void natural;
      const w = wide ? gridTotalW : colW;
      positions.set(shape.id, {
        x: originX + col * (colW + colGap),
        y,
        w,
      });
      col += span;
    }
  } else {
    const byRole = new Map<string, typeof shapes>();
    for (const s of shapes) {
      const role = (s.meta?.['role'] as string) ?? 'primary';
      if (!byRole.has(role)) byRole.set(role, []);
      byRole.get(role)!.push(s);
    }
    for (const role of ROLE_ORDER) {
      const list = byRole.get(role) ?? [];
      list.forEach((shape, i) => {
        const slot = tpl.slotForRole(role as never, i, viewport);
        const w = shape.props?.w ?? slot.w;
        const x = Math.min(slot.x, viewport.x + viewport.w - w);
        positions.set(shape.id, {
          x: Math.max(viewport.x, x),
          y: slot.y,
        });
      });
    }
  }

  editor.batch(() => {
    for (const shape of shapes) {
      const pos = positions.get(shape.id);
      if (!pos) continue;
      if (pos.w != null) {
        const cur = shapes.find((sh) => sh.id === shape.id);
        editor.updateShape({
          id: shape.id,
          type: shape.type,
          props: { ...(cur?.props ?? {}), w: pos.w },
        } as never);
      }
      if (animate) {
        (
          editor as unknown as {
            animateShape: (
              s: { id: string; type: string; x: number; y: number },
              o: { animation: { duration: number } },
            ) => void;
          }
        ).animateShape(
          { id: shape.id, type: shape.type, x: pos.x, y: pos.y },
          { animation: { duration: 280 } },
        );
      } else {
        editor.updateShape({
          id: shape.id,
          type: shape.type,
          x: pos.x,
          y: pos.y,
        } as never);
      }
    }
  });

  let shouldFit = !!opts.zoomToFit;
  if (!shouldFit && opts.fitIfOverflow && useGrid) {
    let maxY = 0;
    let maxX = 0;
    for (const sh of shapes) {
      const pos = positions.get(sh.id);
      if (!pos) continue;
      maxY = Math.max(maxY, pos.y + (sh.props?.h ?? 200));
      maxX = Math.max(maxX, pos.x + (pos.w ?? sh.props?.w ?? 320));
    }
    shouldFit = maxY > viewport.y + viewport.h || maxX > viewport.x + viewport.w;
  }
  if (shouldFit) {
    const delay = animate ? 320 : 0;
    setTimeout(() => fitLeftOfChat(editor), delay);
  }

  // Bookmark so soft re-tidy knows how far we've grown since.
  writeTidyBookmark(shapes.length);
  return shapes.length;
}

/**
 * After welcome seeds land, settle them into a grid and frame the
 * canvas so the first impression isn't three overlapping cards.
 */
export function settleWelcomeLayout(editor: Editor): void {
  // Wait past the dispatcher's 700ms burst relayout, which would
  // otherwise move the seeds back into role slots after we tidy.
  setTimeout(() => {
    requestAnimationFrame(() => {
      tidyCanvas(editor, { animate: true, zoomToFit: true, forceGrid: true });
    });
  }, 900);
}

/**
 * Auto-tidy after the first few real widgets, then soft-re-tidy whenever
 * the canvas grows by SOFT_RETIDY_GROWTH more widgets. Soft re-tidy does
 * not yank the camera (no zoomToFit) so an in-progress reading session
 * isn't interrupted — it just pulls stragglers into the grid.
 */
let autoTidyTimer: ReturnType<typeof setTimeout> | null = null;

export function maybeAutoTidyAfterPlace(editor: Editor): void {
  const shapes = (
    editor.getCurrentPageShapes() as Array<{
      type: string;
      meta?: Record<string, unknown>;
    }>
  ).filter((s) => s.type.startsWith('opencanvas:'));
  const count = shapes.length;
  const userCount = shapes.filter((s) => s.meta?.['seed'] !== true).length;

  let alreadyTidied = false;
  try {
    alreadyTidied =
      typeof localStorage !== 'undefined' &&
      !!localStorage.getItem(AUTO_TIDY_FLAG);
  } catch {
    /* private browsing */
  }

  if (!alreadyTidied) {
    // First tidy: need a couple of user widgets (or past the welcome set).
    if (userCount < 2 && count < 5) return;
  } else {
    // Soft re-tidy: only when we've grown enough since the last tidy.
    const last = readLastTidyCount();
    if (count < last + SOFT_RETIDY_GROWTH) return;
  }

  scheduleAutoTidy(editor, alreadyTidied);
}

function scheduleAutoTidy(editor: Editor, soft: boolean, attempt = 0): void {
  if (autoTidyTimer) clearTimeout(autoTidyTimer);
  autoTidyTimer = setTimeout(() => {
    autoTidyTimer = null;
    // Soft (and first) tidy: never yank a card mid-drag / mid-edit.
    // Defer a few times, then give up until the next placement.
    if (isCanvasBusy(editor)) {
      if (attempt < 8) scheduleAutoTidy(editor, soft, attempt + 1);
      return;
    }
    try {
      localStorage.setItem(AUTO_TIDY_FLAG, '1');
    } catch {
      /* ignore */
    }
    const n = tidyCanvas(editor, {
      animate: true,
      zoomToFit: !soft,
      fitIfOverflow: soft,
      forceGrid: true,
    });
    if (soft && n > 0) {
      toast.message(`Arranged ${n} widgets`, { duration: 1600 });
    }
    // First auto-tidy is the "strong no-key moment" — offer a star nudge.
    if (!soft && n > 0) {
      setTimeout(() => offerStarNudge(), 2200);
    }
  }, attempt === 0 ? 1200 : 400);
}

/** Test helper — clear the once-flag and last-count bookmark. */
export function resetAutoTidyFlag(): void {
  if (autoTidyTimer) {
    clearTimeout(autoTidyTimer);
    autoTidyTimer = null;
  }
  try {
    localStorage.removeItem(AUTO_TIDY_FLAG);
    localStorage.removeItem(LAST_TIDY_COUNT_KEY);
  } catch {
    /* ignore */
  }
}

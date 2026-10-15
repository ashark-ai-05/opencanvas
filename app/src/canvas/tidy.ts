/**
 * Shared canvas tidy. Used by `/tidy`, the welcome-seed settle, and the
 * once-per-fresh-canvas auto-tidy after the first few user widgets.
 *
 * Places every opencanvas widget into the active template's role slots,
 * using the chat-aware placementBounds so nothing ends up under the
 * floating panel. Optionally zooms to fit afterwards.
 */
import type { Editor } from 'tldraw';
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

export type TidyOptions = {
  /** Animate into slots (default true). */
  animate?: boolean;
  /** After laying out, zoom the viewport to fit (default false). */
  zoomToFit?: boolean;
  /** Only rearrange shapes whose ids are in this set. */
  onlyIds?: Set<string>;
  /** Force the wrap-grid layout even when role columns would fit. */
  forceGrid?: boolean;
};

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

  // Prefer the template's role columns when they fit in the usable
  // area (left of the chat). When the chat has squeezed the viewport
  // so columns would clamp on top of each other, fall back to a
  // left-to-right wrap grid — that's what makes a fresh canvas look
  // intentional instead of a pile under the panel.
  const colGap = 28;
  const rowGap = 20;
  // Column count must come from SCREEN pixels, not the current page
  // viewport. After welcome zoomToFit the page-space width collapses
  // (~600px at 150%), which would force a single-column stack — the
  // exact "scattered pile" look we're trying to avoid. Screen width
  // stays ~1000px with the chat open, so we keep 2–3 columns and let
  // zoomToFit frame the result.
  const colW = 320;
  let usableScreenW = 1000;
  try {
    if (typeof document !== 'undefined') {
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
    }
  } catch {
    /* probing must never break tidy */
  }
  const colsFromScreen = Math.max(
    1,
    Math.min(3, Math.floor((usableScreenW - 48) / (colW + colGap))),
  );
  // Content-aware target. Prefer 2 columns once there are a few
  // widgets so the rightmost card doesn't sit under the floating
  // chat (welcome's sticky used to). Denser canvases go to 3.
  const desiredCols =
    shapes.length <= 2 ? Math.max(1, shapes.length) : shapes.length <= 6 ? 2 : 3;
  const colsThatFit = Math.max(1, Math.min(desiredCols, colsFromScreen));
  const useGrid = opts.forceGrid === true || colsFromScreen < 2;

  const positions = new Map<string, { x: number; y: number; w?: number }>();
  if (useGrid) {
    let col = 0;
    let row = 0;
    const originX = viewport.x + 24;
    const originY = viewport.y + 24;
    // Use each card's real height so a short reminder doesn't leave a gap.
    const rowHeights: number[] = [];
    for (const shape of shapes) {
      const h = shape.props?.h ?? 200;
      if (col >= colsThatFit) {
        col = 0;
        row += 1;
      }
      rowHeights[row] = Math.max(rowHeights[row] ?? 0, h);
      const y =
        originY +
        rowHeights.slice(0, row).reduce((a, b) => a + b + rowGap, 0);
      positions.set(shape.id, {
        x: originX + col * (colW + colGap),
        y,
        w: colW,
      });
      col += 1;
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
      const next: { id: string; type: string; x: number; y: number; props?: { w: number } } = {
        id: shape.id,
        type: shape.type,
        x: pos.x,
        y: pos.y,
      };
      if (pos.w != null) {
        next.props = { w: pos.w };
      }
      // Width changes go through updateShape; position can animate.
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
        editor.updateShape({ id: shape.id, type: shape.type, x: pos.x, y: pos.y } as never);
      }
    }
  });

  if (opts.zoomToFit) {
    // Let the animate settle a beat before framing.
    const delay = animate ? 320 : 0;
    setTimeout(() => {
      try {
        (
          editor as unknown as {
            zoomToFit?: (o: { animation: { duration: number } }) => void;
          }
        ).zoomToFit?.({ animation: { duration: 280 } });
      } catch {
        /* editor torn down */
      }
    }, delay);
  }

  return shapes.length;
}

/**
 * After welcome seeds land, settle them into role slots and frame the
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
 * Once per fresh canvas: after a few real (non-seed) widgets have been
 * placed, tidy everything so timers, reminders and REST tables don't
 * pile up under the chat. Seeds don't count toward the trigger, but
 * they do get rearranged with everything else.
 */
let autoTidyTimer: ReturnType<typeof setTimeout> | null = null;

export function maybeAutoTidyAfterPlace(editor: Editor): void {
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(AUTO_TIDY_FLAG)) {
      return;
    }
  } catch {
    /* private browsing */
  }

  const shapes = (
    editor.getCurrentPageShapes() as Array<{
      type: string;
      meta?: Record<string, unknown>;
    }>
  ).filter((s) => s.type.startsWith('opencanvas:'));
  const userCount = shapes.filter((s) => s.meta?.['seed'] !== true).length;
  // Trigger once the user has placed a couple of their own widgets, or
  // the canvas has grown past the welcome set.
  if (userCount < 2 && shapes.length < 5) return;

  // Debounce: every new placement inside the window pushes the tidy
  // back, so a burst ("25 min focus", "remind me…", "12 km in miles")
  // is arranged once, after the last card lands.
  if (autoTidyTimer) clearTimeout(autoTidyTimer);
  autoTidyTimer = setTimeout(() => {
    autoTidyTimer = null;
    try {
      localStorage.setItem(AUTO_TIDY_FLAG, '1');
    } catch {
      /* ignore */
    }
    tidyCanvas(editor, { animate: true, zoomToFit: true, forceGrid: true });
  }, 1200);
}

/** Test helper — clear the once-flag. */
export function resetAutoTidyFlag(): void {
  if (autoTidyTimer) {
    clearTimeout(autoTidyTimer);
    autoTidyTimer = null;
  }
  try {
    localStorage.removeItem(AUTO_TIDY_FLAG);
  } catch {
    /* ignore */
  }
}

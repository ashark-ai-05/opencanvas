import { useEditor, useValue } from 'tldraw';
import { ChevronDown, Compass } from 'lucide-react';
import { useUiStore } from '../state/ui-store';

/**
 * Bottom-left minimap. Renders a live SVG thumbnail of every strata
 * widget on the page (role-tinted), with the current viewport drawn as
 * an outline. Click to pan to the clicked point; double-click to fit
 * the whole content. Hides when the canvas has zero strata widgets.
 *
 * Mounted INSIDE <Tldraw> so `useEditor` + `useValue` give us reactive
 * reads against the editor store without manual subscriptions.
 *
 * Spec: REPLICATION-PROMPT.md §13 — `CanvasMap`.
 */

const W = 200; // minimap pixel width
const H = 140; // minimap pixel height
const PADDING = 8;

const ROLE_COLOUR: Record<string, string> = {
  primary: 'var(--role-primary)',
  detail: 'var(--role-detail)',
  related: 'var(--role-related)',
  reference: 'var(--role-reference)',
  timeline: 'var(--role-timeline)',
  node: 'var(--role-node)',
};

export function CanvasMap() {
  const editor = useEditor();
  const collapsed = useUiStore((s) => s.canvasMapCollapsed);
  const setCollapsed = useUiStore((s) => s.setCanvasMapCollapsed);

  // Reactive: every page shape that's a strata:* widget. Re-runs when
  // shapes are added/moved/resized.
  const widgets = useValue(
    'strata widgets',
    () =>
      editor
        .getCurrentPageShapes()
        .filter((s) => s.type.startsWith('strata:'))
        .map((s) => {
          const bounds = editor.getShapePageBounds(s.id);
          if (!bounds) return null;
          const role = (s.meta?.['role'] as string | undefined) ?? 'primary';
          return {
            id: s.id,
            x: bounds.x,
            y: bounds.y,
            w: bounds.w,
            h: bounds.h,
            role,
          };
        })
        .filter((w): w is NonNullable<typeof w> => w !== null),
    [editor],
  );

  // Reactive viewport bounds in page space.
  const viewport = useValue(
    'viewport bounds',
    () => {
      const b = editor.getViewportPageBounds();
      return { x: b.x, y: b.y, w: b.w, h: b.h };
    },
    [editor],
  );

  if (widgets.length === 0) return null;

  // Compute the world bounds we need to fit — the union of all widget
  // rects AND the viewport, so the user always sees their viewport
  // marker even when they're panned away from any widget.
  const worldX1 = Math.min(viewport.x, ...widgets.map((w) => w.x));
  const worldY1 = Math.min(viewport.y, ...widgets.map((w) => w.y));
  const worldX2 = Math.max(
    viewport.x + viewport.w,
    ...widgets.map((w) => w.x + w.w),
  );
  const worldY2 = Math.max(
    viewport.y + viewport.h,
    ...widgets.map((w) => w.y + w.h),
  );
  const worldW = Math.max(1, worldX2 - worldX1);
  const worldH = Math.max(1, worldY2 - worldY1);

  // Fit the world into (W - 2*padding) × (H - 2*padding), preserving
  // aspect — letterbox with padding.
  const innerW = W - PADDING * 2;
  const innerH = H - PADDING * 2;
  const scale = Math.min(innerW / worldW, innerH / worldH);
  const offsetX = (W - worldW * scale) / 2 - worldX1 * scale;
  const offsetY = (H - worldH * scale) / 2 - worldY1 * scale;

  // Translate page-space → minimap-space.
  const toMap = (px: number, py: number) => ({
    x: px * scale + offsetX,
    y: py * scale + offsetY,
  });

  // Click → pan to the clicked page-space point. Double-click → fit all.
  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.detail >= 2) {
      editor.zoomToFit({ animation: { duration: 220 } });
      return;
    }
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const px = (mx - offsetX) / scale;
    const py = (my - offsetY) / scale;
    editor.centerOnPoint({ x: px, y: py }, { animation: { duration: 200 } });
  };

  const vpTopLeft = toMap(viewport.x, viewport.y);
  const vpW = viewport.w * scale;
  const vpH = viewport.h * scale;

  return (
    <div
      className="strata-canvas-map"
      data-collapsed={collapsed ? 'true' : 'false'}
      role="region"
      aria-label="Canvas overview"
    >
      <div className="strata-canvas-map-header">
        <Compass className="size-3" />
        <span>{widgets.length}</span>
        <button
          type="button"
          className="strata-canvas-map-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand minimap' : 'Collapse minimap'}
          title={collapsed ? 'Expand minimap' : 'Collapse minimap'}
          onClick={() => setCollapsed(!collapsed)}
        >
          <ChevronDown
            className="size-3"
            style={{
              transform: collapsed ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 200ms ease',
            }}
          />
        </button>
      </div>
      {!collapsed && (
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        onClick={handleClick}
        className="strata-canvas-map-svg"
      >
        {/* Widget rects — role-tinted fills, soft. */}
        {widgets.map((w) => {
          const tl = toMap(w.x, w.y);
          return (
            <rect
              key={w.id}
              x={tl.x}
              y={tl.y}
              width={Math.max(2, w.w * scale)}
              height={Math.max(2, w.h * scale)}
              rx={2}
              fill={ROLE_COLOUR[w.role] ?? ROLE_COLOUR['primary']}
              fillOpacity={0.55}
              stroke={ROLE_COLOUR[w.role] ?? ROLE_COLOUR['primary']}
              strokeOpacity={0.9}
              strokeWidth={0.75}
            />
          );
        })}
        {/* Viewport rectangle — bright outline so it always reads. */}
        <rect
          x={vpTopLeft.x}
          y={vpTopLeft.y}
          width={Math.max(4, vpW)}
          height={Math.max(4, vpH)}
          fill="rgba(167, 139, 250, 0.10)"
          stroke="rgba(167, 139, 250, 0.95)"
          strokeWidth={1.5}
          rx={2}
          pointerEvents="none"
        />
      </svg>
      )}
    </div>
  );
}

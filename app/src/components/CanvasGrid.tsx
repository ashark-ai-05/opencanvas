/**
 * Subtle dotted grid that sits BEHIND the tldraw canvas.
 *
 * Pure CSS — no JS, no canvas — so it costs nothing on a heavy widget
 * board. Pointer events are disabled so all clicks pass through to
 * tldraw.
 *
 * Spec: REPLICATION-PROMPT.md §13 — `CanvasGrid`.
 */
export function CanvasGrid() {
  return (
    <div
      aria-hidden
      className="opencanvas-canvas-grid"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}

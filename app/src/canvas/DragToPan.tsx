import { useEffect } from 'react';
import { useEditor } from 'tldraw';

/**
 * Drag-empty-canvas-to-pan with cinematic inertia + click-to-deselect.
 *
 * Event policy (this is the subtle bit):
 *   We DON'T block pointerdown or click-pointerup at all. tldraw's
 *   select-tool natively handles "click empty → deselect", so letting
 *   those events through means we get deselect-on-click for free.
 *   We only `stopPropagation` on pointermove (so tldraw doesn't start
 *   a marquee mid-pan) and on pointerup-after-pan (so tldraw doesn't
 *   try to finalize a brush we never let it start).
 *
 * Gesture states:
 *   - Idle                  → no listeners doing anything special
 *   - Pending (pointerdown
 *     on empty, no shift)   → recording start coords; tldraw is also
 *                             in its own "pointing canvas" sub-state
 *   - Panning (after        → we own the gesture: stopProp moves,
 *     PAN_THRESHOLD_PX)       update camera with immediate:true
 *   - Inertia               → after pointerup-pan, exponential decay
 *                             rAF loop applies remaining velocity
 *
 * Cancellation:
 *   - New pointerdown → cancels active inertia
 *   - pointercancel   → drops state, no glide
 *   - shift+drag      → returns immediately; tldraw runs marquee
 *   - shape under cursor → returns immediately; tldraw moves the shape
 */
const PAN_THRESHOLD_PX = 4;
// Inertia glide tuning. The decay is the "look" (how the curve eases
// out); the stop-velocity is the "tail" (how long it crawls before
// snapping to a halt). 0.92 + 0.1 lands at ~1 second of glide with
// total distance ≈ 12× release velocity — still slow-motion in feel,
// but travels half as far as the previous 0.96/0.03 tuning.
const DECAY_PER_FRAME = 0.92;
const STOP_VELOCITY_PX_PER_FRAME = 0.1;
const VELOCITY_WINDOW_MS = 60;

type Sample = { t: number; dx: number; dy: number };

export function DragToPan() {
  const editor = useEditor();

  useEffect(() => {
    const container = editor.getContainer();
    let activePointerId: number | null = null;
    let pending = false;
    let panning = false;
    let startScreenX = 0;
    let startScreenY = 0;
    let startCam = { x: 0, y: 0, z: 1 };
    let lastScreenX = 0;
    let lastScreenY = 0;
    let prevCursor = '';
    let inertiaRaf: number | null = null;
    const samples: Sample[] = [];

    const cancelInertia = () => {
      if (inertiaRaf !== null) {
        cancelAnimationFrame(inertiaRaf);
        inertiaRaf = null;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      // A new pointerdown always cancels any in-flight inertia glide
      // so the next gesture feels in-control.
      cancelInertia();

      if (e.button !== 0) return;
      if (editor.getCurrentToolId() !== 'select') return;
      if (e.shiftKey) return;

      const pagePoint = editor.screenToPage({ x: e.clientX, y: e.clientY });
      const shape = editor.getShapeAtPoint(pagePoint, {
        hitInside: true,
        margin: 4,
      });
      if (shape) return; // tldraw moves the shape — don't claim the gesture

      // Note: we DON'T stopPropagation here. tldraw enters its own
      // "pointing canvas" state, which (a) keeps existing selection
      // alive during a potential pan, and (b) deselects on
      // pointerup-without-movement — exactly the behavior we want.
      activePointerId = e.pointerId;
      pending = true;
      panning = false;
      startScreenX = lastScreenX = e.clientX;
      startScreenY = lastScreenY = e.clientY;
      startCam = editor.getCamera();
      samples.length = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      if (!pending && !panning) return;

      const dxTotal = e.clientX - startScreenX;
      const dyTotal = e.clientY - startScreenY;

      // Commit to pan once movement clears the click-vs-drag threshold.
      if (!panning && Math.hypot(dxTotal, dyTotal) >= PAN_THRESHOLD_PX) {
        panning = true;
        prevCursor = container.style.cursor;
        container.style.cursor = 'grabbing';
        // Once we own the gesture, hide it from tldraw so it doesn't
        // start drawing a marquee on top of our pan. The pointerdown
        // was already through, so tldraw's "pointing canvas" → idle
        // transition will happen later when we stop blocking events.
      }

      if (panning) {
        // Block tldraw from seeing further moves. With pointermove
        // suppressed, tldraw's select-tool stays in "pointing canvas"
        // and never escalates to "brushing" — so no marquee flicker.
        e.stopPropagation();

        const z = startCam.z;
        editor.setCamera(
          { x: startCam.x + dxTotal / z, y: startCam.y + dyTotal / z, z },
          { immediate: true },
        );

        const now = performance.now();
        samples.push({
          t: now,
          dx: e.clientX - lastScreenX,
          dy: e.clientY - lastScreenY,
        });
        // Drop samples older than the rolling window so a long slow
        // gesture doesn't pollute final-release velocity.
        while (samples.length > 0 && now - samples[0]!.t > VELOCITY_WINDOW_MS) {
          samples.shift();
        }
      }

      lastScreenX = e.clientX;
      lastScreenY = e.clientY;
    };

    const computeReleaseVelocity = (): { vx: number; vy: number } => {
      if (samples.length < 2) return { vx: 0, vy: 0 };
      let sumDx = 0;
      let sumDy = 0;
      for (const s of samples) {
        sumDx += s.dx;
        sumDy += s.dy;
      }
      const span = Math.max(
        16,
        samples[samples.length - 1]!.t - samples[0]!.t,
      );
      const framesInSpan = span / 16.67;
      return { vx: sumDx / framesInSpan, vy: sumDy / framesInSpan };
    };

    const startInertia = (vx: number, vy: number) => {
      if (Math.hypot(vx, vy) < STOP_VELOCITY_PX_PER_FRAME) return;

      let curVx = vx;
      let curVy = vy;
      const glideStartCam = editor.getCamera();
      let accumDx = 0;
      let accumDy = 0;
      const z = glideStartCam.z;

      const tick = () => {
        accumDx += curVx;
        accumDy += curVy;
        editor.setCamera(
          {
            x: glideStartCam.x + accumDx / z,
            y: glideStartCam.y + accumDy / z,
            z,
          },
          { immediate: true },
        );
        curVx *= DECAY_PER_FRAME;
        curVy *= DECAY_PER_FRAME;
        if (Math.hypot(curVx, curVy) < STOP_VELOCITY_PX_PER_FRAME) {
          inertiaRaf = null;
          return;
        }
        inertiaRaf = requestAnimationFrame(tick);
      };
      inertiaRaf = requestAnimationFrame(tick);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;

      const wasPan = panning;

      activePointerId = null;
      pending = false;
      panning = false;
      container.style.cursor = prevCursor;

      if (wasPan) {
        // Suppress tldraw's pointerup so it doesn't try to finalize a
        // brushing state we never entered, then glide to a fluid stop.
        e.stopPropagation();
        const { vx, vy } = computeReleaseVelocity();
        startInertia(vx, vy);
        return;
      }

      // Click on empty canvas — pointerup propagates and tldraw's
      // select-tool naturally clears selection. We call selectNone()
      // belt-and-braces in case a future tldraw version changes that
      // default; it's idempotent.
      editor.selectNone();
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      pending = false;
      panning = false;
      container.style.cursor = prevCursor;
    };

    container.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    return () => {
      cancelInertia();
      container.removeEventListener('pointerdown', onPointerDown, {
        capture: true,
      });
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      container.style.cursor = prevCursor;
    };
  }, [editor]);

  return null;
}

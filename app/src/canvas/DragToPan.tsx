import { useEffect } from 'react';
import { useEditor } from 'tldraw';

/**
 * Figma-style "drag empty space to pan" with click-to-deselect and
 * post-release inertia.
 *
 * Gesture model:
 *   - Pointerdown on a shape           → return; tldraw handles the move
 *   - Pointerdown on empty + shift     → return; tldraw runs marquee select
 *   - Pointerdown on empty + no shift  → tentatively claim, BUT don't
 *                                        commit to pan until movement
 *                                        exceeds PAN_THRESHOLD_PX
 *   - Click without movement           → editor.setSelectedShapes([]) so
 *                                        clicking empty deselects (we
 *                                        stopPropagation tldraw's own
 *                                        click handling to keep the
 *                                        gesture deterministic)
 *   - Drag past threshold              → enter pan mode; track windowed
 *                                        velocity for inertia on release
 *   - Pointerup with active pan        → start an exponential-decay
 *                                        rAF loop that applies the last
 *                                        velocity, multiplied by DECAY
 *                                        each frame, until below
 *                                        STOP_VELOCITY — gives the
 *                                        camera a fluid glide instead
 *                                        of a hard stall
 *   - New pointerdown during glide     → cancel inertia immediately so
 *                                        the next gesture takes over
 */
const PAN_THRESHOLD_PX = 4;
const DECAY_PER_FRAME = 0.92;
const STOP_VELOCITY_PX_PER_FRAME = 0.05;
const VELOCITY_WINDOW_MS = 50;

type Sample = { t: number; dx: number; dy: number };

export function DragToPan() {
  const editor = useEditor();

  useEffect(() => {
    const container = editor.getContainer();
    let activePointerId: number | null = null;
    let pendingShape = false; // true between pointerdown and threshold cross
    let panning = false;
    let startScreenX = 0;
    let startScreenY = 0;
    let startCam = { x: 0, y: 0, z: 1 };
    let lastScreenX = 0;
    let lastScreenY = 0;
    let lastMoveAt = 0;
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
      // A new pointerdown always cancels any in-flight inertia glide so
      // the user feels in control.
      cancelInertia();

      if (e.button !== 0) return;
      if (editor.getCurrentToolId() !== 'select') return;
      if (e.shiftKey) return;

      const pagePoint = editor.screenToPage({ x: e.clientX, y: e.clientY });
      const shape = editor.getShapeAtPoint(pagePoint, {
        hitInside: true,
        margin: 4,
      });
      if (shape) return; // pointer is on a widget — let tldraw handle it

      // Block tldraw from running its own select-tool state machine for
      // this gesture. We'll either pan (on movement) or deselect (on
      // release with no movement) ourselves. This keeps the gesture
      // deterministic — no marquee flicker, no race with tldraw's
      // pointing-canvas sub-state.
      e.stopPropagation();
      e.preventDefault();

      activePointerId = e.pointerId;
      pendingShape = true;
      panning = false;
      startScreenX = lastScreenX = e.clientX;
      startScreenY = lastScreenY = e.clientY;
      startCam = editor.getCamera();
      lastMoveAt = performance.now();
      samples.length = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      if (!pendingShape && !panning) return;

      const now = performance.now();
      const dxTotal = e.clientX - startScreenX;
      const dyTotal = e.clientY - startScreenY;

      // Commit to pan once we move past the click threshold. Without
      // this gate, a single-pixel cursor jitter on click would steal
      // the deselect.
      if (!panning && Math.hypot(dxTotal, dyTotal) >= PAN_THRESHOLD_PX) {
        panning = true;
        prevCursor = container.style.cursor;
        container.style.cursor = 'grabbing';
      }

      if (panning) {
        e.stopPropagation();
        const z = startCam.z;
        editor.setCamera(
          { x: startCam.x + dxTotal / z, y: startCam.y + dyTotal / z, z },
          { immediate: true },
        );
        // Record a velocity sample (px since last move). Used for the
        // inertia glide computed on pointerup.
        samples.push({
          t: now,
          dx: e.clientX - lastScreenX,
          dy: e.clientY - lastScreenY,
        });
        // Drop samples older than the rolling window so a long, slow
        // gesture doesn't pollute the final-release velocity.
        while (samples.length > 0 && now - samples[0]!.t > VELOCITY_WINDOW_MS) {
          samples.shift();
        }
      }

      lastScreenX = e.clientX;
      lastScreenY = e.clientY;
      lastMoveAt = now;
    };

    const computeReleaseVelocity = (): { vx: number; vy: number } => {
      if (samples.length === 0) return { vx: 0, vy: 0 };
      // Average screen-px delta per frame across the sample window.
      // We assume ~60fps, so frame = 16.67ms; the sum-of-deltas over
      // the window divided by (window_ms / 16.67) yields per-frame
      // velocity in screen pixels.
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
      return {
        vx: sumDx / framesInSpan,
        vy: sumDy / framesInSpan,
      };
    };

    const startInertia = (vx: number, vy: number) => {
      // Bail if the gesture wasn't fast enough to bother gliding.
      const speed = Math.hypot(vx, vy);
      if (speed < STOP_VELOCITY_PX_PER_FRAME) return;

      let curVx = vx;
      let curVy = vy;
      let glideStartCam = editor.getCamera();
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
      e.stopPropagation();

      const wasClick = pendingShape && !panning;
      const wasPan = panning;

      activePointerId = null;
      pendingShape = false;
      panning = false;
      container.style.cursor = prevCursor;

      if (wasClick) {
        // Click on empty canvas — clear selection. We blocked tldraw's
        // pointer handling, so we own this behavior.
        const selected = editor.getSelectedShapeIds();
        if (selected.length > 0) {
          editor.setSelectedShapes([]);
        }
      } else if (wasPan) {
        // Glide to a fluid stop based on the recent velocity window.
        const { vx, vy } = computeReleaseVelocity();
        startInertia(vx, vy);
      }
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerId !== activePointerId) return;
      activePointerId = null;
      pendingShape = false;
      panning = false;
      container.style.cursor = prevCursor;
      // Don't glide on cancel — the gesture was aborted, not released.
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

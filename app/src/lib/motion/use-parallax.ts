import { useRef, useCallback, useState, useEffect } from 'react';
import {
  useMotionValue,
  useSpring,
  useTransform,
  useReducedMotion,
  type MotionValue,
} from 'framer-motion';
import { spring, type SpringPreset } from './springs';

interface UseParallaxOptions {
  /** Maximum tilt in degrees on either axis. Default 3 (Ambient calibration). */
  maxTilt?: number;
  /** Whether the surface lifts toward the pointer in z. Default true. */
  lift?: boolean;
  /** Spring preset name. Default 'firm'. */
  spring?: SpringPreset;
}

interface UseParallaxReturn {
  ref: React.MutableRefObject<HTMLElement | null>;
  rotateX: MotionValue<number>;
  rotateY: MotionValue<number>;
  translateZ: MotionValue<number>;
  /**
   * True from first onPointerMove until ~400ms after onPointerLeave (long
   * enough for the spring to settle near 0). Consumers should gate their
   * `transform`/`transformPerspective` style on this flag — when false, the
   * surface should render WITHOUT 3D transforms so text stays on the CPU
   * rasterizer with full subpixel hinting (3D-transformed layers are
   * texture-rasterized and ~5–10% softer).
   */
  isActive: boolean;
  bind: {
    onPointerMove: (e: PointerEvent | React.PointerEvent) => void;
    onPointerLeave: () => void;
  };
}

/**
 * Pointer-tracked parallax hook.
 *
 * Returns motion values (NOT a style object) so framer-motion can update
 * the DOM via requestAnimationFrame without re-rendering React. The hook
 * fires hundreds of times per second during pointer move; React renders
 * exactly once on mount.
 *
 * Reduced-motion: when the user has `prefers-reduced-motion: reduce` set,
 * all motion values stay at 0 regardless of pointer activity. Required —
 * tilt without this is a vestibular accessibility violation.
 *
 * Perspective: consumers MUST set `transformPerspective: 1200` (or similar)
 * on the same `style` block — otherwise rotateX/Y read as flat skew, not
 * 3D tilt. See spec §motion-primitives.
 */
export function useParallax(opts: UseParallaxOptions = {}): UseParallaxReturn {
  const {
    maxTilt = 3,
    lift = true,
    spring: springName = 'firm',
  } = opts;

  const ref = useRef<HTMLElement | null>(null);
  const rawX = useMotionValue(0); // -0.5 .. 0.5 normalized
  const rawY = useMotionValue(0);

  const config = spring[springName];
  const smoothX = useSpring(rawX, config);
  const smoothY = useSpring(rawY, config);

  const reducedMotion = useReducedMotion();

  // isActive: true while the surface is being interacted with, false after
  // the spring has had time to settle back to 0. Gates the 3D transform
  // pipeline so resting cards keep crisp CPU-rasterized text.
  const [isActive, setIsActive] = useState(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    };
  }, []);

  // When reduced motion is active, expose constant 0 motion values.
  // We can't conditionally call hooks, so we always create them and
  // return constants instead.
  const zeroX = useMotionValue(0);
  const zeroY = useMotionValue(0);
  const zeroZ = useMotionValue(0);

  const rotateY = useTransform(smoothX, [-0.5, 0.5], [maxTilt, -maxTilt]);
  const rotateX = useTransform(smoothY, [-0.5, 0.5], [-maxTilt, maxTilt]);
  const translateZ = useTransform(
    [smoothX, smoothY] as MotionValue<number>[],
    (values) => {
      const [xv, yv] = values as [number, number];
      return lift ? Math.hypot(xv, yv) * 8 : 0;
    },
  );

  const onPointerMove = useCallback(
    (e: PointerEvent | React.PointerEvent) => {
      if (reducedMotion) return;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const px = (e.clientX - rect.left) / rect.width - 0.5;
      const py = (e.clientY - rect.top) / rect.height - 0.5;
      // Cancel any pending settle — pointer is back inside the surface.
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      setIsActive((prev) => prev || true);
      rawX.set(px);
      rawY.set(py);
    },
    [reducedMotion, rawX, rawY],
  );

  const onPointerLeave = useCallback(() => {
    rawX.set(0);
    rawY.set(0);
    // Wait for the spring to settle near 0 before flipping isActive false.
    // 'firm' spring settles in ~300ms; 450ms gives a safety margin so we
    // don't strip the 3D context mid-animation (which would snap the card
    // visibly).
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      setIsActive(false);
      settleTimerRef.current = null;
    }, 450);
  }, [rawX, rawY]);

  if (reducedMotion) {
    return {
      ref,
      rotateX: zeroX,
      rotateY: zeroY,
      translateZ: zeroZ,
      isActive: false,
      bind: { onPointerMove, onPointerLeave },
    };
  }

  return {
    ref,
    rotateX,
    rotateY,
    translateZ,
    isActive,
    bind: { onPointerMove, onPointerLeave },
  };
}

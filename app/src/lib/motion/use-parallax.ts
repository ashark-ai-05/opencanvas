import { useRef, useCallback } from 'react';
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
      rawX.set(px);
      rawY.set(py);
    },
    [reducedMotion, rawX, rawY],
  );

  const onPointerLeave = useCallback(() => {
    rawX.set(0);
    rawY.set(0);
  }, [rawX, rawY]);

  if (reducedMotion) {
    return {
      ref,
      rotateX: zeroX,
      rotateY: zeroY,
      translateZ: zeroZ,
      bind: { onPointerMove, onPointerLeave },
    };
  }

  return {
    ref,
    rotateX,
    rotateY,
    translateZ,
    bind: { onPointerMove, onPointerLeave },
  };
}

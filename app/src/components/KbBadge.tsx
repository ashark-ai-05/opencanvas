import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database } from 'lucide-react';
import { useKbStats } from '../state/kb-stats-store';

/**
 * Header badge that surfaces the total chunk count + animates a "+N"
 * floater whenever conversations index back. Click opens the
 * SourcesPanel — single entry point for "see what's in the KB".
 */
export function KbBadge({ onClick }: { onClick: () => void }) {
  const total = useKbStats((s) => s.totalChunks);
  const lastDelta = useKbStats((s) => s.lastDelta);
  const hydrated = useKbStats((s) => s.hydrated);

  // Tween the displayed number so increments feel earned. Snap when the
  // delta is large (initial hydrate) so we don't spend 30s counting up.
  const display = useTweenedNumber(total, lastDelta > 12 ? 0 : 600);

  // Show a "+N" floater when bump fires. Visible only briefly.
  const [pulseKey, setPulseKey] = useState(0);
  const lastDeltaShownRef = useRef(0);
  useEffect(() => {
    if (lastDelta > 0 && lastDelta !== lastDeltaShownRef.current) {
      lastDeltaShownRef.current = lastDelta;
      setPulseKey((k) => k + 1);
    }
  }, [lastDelta]);

  if (!hydrated) {
    // Empty placeholder so the layout doesn't shift when stats hydrate.
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label="Knowledge base"
        title="Knowledge base — sources indexed"
        className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12px] font-medium text-zinc-300 hover:text-white border border-white/8 hover:border-white/15 transition-colors"
        style={{ background: 'rgba(255,255,255,0.03)' }}
      >
        <Database className="size-3" />
        <span className="hidden sm:inline">KB</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Knowledge base — ${total} chunks indexed`}
      title={`Knowledge base — ${total} chunks indexed`}
      className="relative inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12px] font-medium text-zinc-300 hover:text-white border border-white/8 hover:border-white/15 transition-colors strata-kb-badge"
      data-pulse-key={pulseKey}
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      <Database className="size-3" />
      <span className="hidden sm:inline">KB</span>
      <span
        className="font-mono text-zinc-400 tabular-nums"
        style={{ color: lastDelta > 0 ? '#c4b5fd' : undefined, transition: 'color 800ms ease' }}
      >
        {formatCount(display)}
      </span>

      {/* Floating "+N" delta — appears on bump, drifts up + fades out. */}
      <AnimatePresence>
        {pulseKey > 0 && lastDelta > 0 && (
          <motion.span
            key={pulseKey}
            initial={{ opacity: 0, y: 0, scale: 0.85 }}
            animate={{ opacity: 1, y: -14, scale: 1 }}
            exit={{ opacity: 0, y: -22, scale: 0.95 }}
            transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
            className="absolute right-1 top-0 pointer-events-none font-mono text-[11px] font-semibold"
            style={{ color: '#c4b5fd' }}
            aria-hidden
          >
            +{lastDelta}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

/**
 * Smoothly tween a counter's displayed value toward `target` over
 * `duration` ms. Uses requestAnimationFrame so we don't allocate
 * per-tick. When duration is 0 (or target snaps backward), jumps.
 */
function useTweenedNumber(target: number, duration: number): number {
  const [display, setDisplay] = useState(target);
  const fromRef = useRef(target);
  const startedAtRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (duration <= 0 || target < display) {
      // Snap on hydrate / decrement (delete a conversation, etc.)
      setDisplay(target);
      fromRef.current = target;
      return;
    }
    fromRef.current = display;
    startedAtRef.current = performance.now();

    const step = (now: number) => {
      const t = Math.min(1, (now - startedAtRef.current!) / duration);
      // ease-out cubic for a "settling" feel
      const eased = 1 - Math.pow(1 - t, 3);
      const v = Math.round(
        fromRef.current + (targetRef.current - fromRef.current) * eased,
      );
      setDisplay(v);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return display;
}

function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

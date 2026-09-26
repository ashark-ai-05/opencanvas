import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WidgetKind } from '../../../src/agent/types';
import { classify, isEscaped } from '../intent/classify';
import {
  activeIntent,
  changedSubstantially,
  decide,
  force,
  initialMemory,
  promote as promoteMem,
  rawState,
  THRESHOLDS,
  type DecideMemory,
  type UiState,
} from '../intent/decide';
import { resolve, type IconName } from '../intent/registry';
import type { CardIntent, IntentResult } from '../intent/types';

export const FAST_LANE_DEBOUNCE_MS = 120;

export type FastLaneResolved = {
  intent: CardIntent;
  kind: WidgetKind;
  label: string;
  icon: IconName;
  summary: string;
  /** null while the parse is incomplete (chip shows, Enter goes to the model). */
  payload: Record<string, unknown> | null;
};

export type FastLaneView = {
  ui: UiState;
  /** Present for ghost and committed states. */
  resolved: FastLaneResolved | null;
  /** Present for the choose state: [label, label]. */
  options: [{ intent: CardIntent; label: string }, { intent: CardIntent; label: string }] | null;
  /**
   * True only when the committed intent is still backed by the latest
   * classify result (or was explicitly forced). A committed intent can
   * otherwise go stale under hysteresis — it takes two consecutive wins
   * (or a ≥0.85 override) for a challenger to unseat it — so Enter must
   * check this, not just `ui.kind === 'committed'`.
   */
  placeable: boolean;
  promote: () => void;
  choose: (i: 0 | 1) => void;
  dismiss: () => void;
};

export type UseFastLaneOptions = {
  enabled: boolean;
  /** Reference "now" for date parsing. Defaults to the wall clock. */
  ref?: () => Date;
};

export function useFastLane(text: string, opts: UseFastLaneOptions): FastLaneView {
  const { enabled } = opts;
  const ref = opts.ref ?? (() => new Date());
  const [mem, setMem] = useState<DecideMemory>(initialMemory);
  const [lastResult, setLastResult] = useState<IntentResult | null>(null);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || isEscaped(text)) {
      setMem(initialMemory);
      setLastResult(null);
      return;
    }
    if (dismissedFor !== null) {
      if (!changedSubstantially(dismissedFor, text)) {
        setMem(initialMemory);
        return;
      }
      setDismissedFor(null);
    }
    const id = setTimeout(() => {
      const result = classify(text, { ref: ref() });
      setLastResult(result);
      setMem((m) => decide(m, result, text));
    }, FAST_LANE_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // `ref` is a stable getter by contract; excluding it avoids re-arming on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, enabled, dismissedFor]);

  // `mem.ui` is hysteresis memory: once committed, it takes two consecutive
  // challenger wins (or a ≥0.85 override) to change, so it can stay
  // "committed: todo" for a beat after the text has moved on entirely to
  // "25 min". `support` is how much the *latest* classify result still
  // backs that committed/ghost intent; when it collapses below dropBelow,
  // the view hides the stale chip even though the internal memory (still
  // useful for its hysteresis on the next keystroke) hasn't caught up yet.
  const internalIntent = activeIntent(mem.ui);
  const support =
    lastResult && internalIntent ? (lastResult.intent.probabilities[internalIntent] ?? 0) : 0;
  const fresh = lastResult ? rawState(lastResult) : null;
  const placeable =
    mem.ui.kind === 'committed' &&
    (mem.ui.forced === true || (fresh?.kind === 'committed' && fresh.intent === mem.ui.intent));
  const stale =
    (mem.ui.kind === 'committed' || mem.ui.kind === 'ghost') && support < THRESHOLDS.dropBelow;
  const ui: UiState = stale ? { kind: 'input' } : mem.ui;

  const resolved = useMemo<FastLaneResolved | null>(() => {
    if (stale) return null;
    const intent = activeIntent(mem.ui);
    if (!intent || !enabled) return null;
    const r = resolve(intent, text, ref());
    return {
      intent,
      kind: r.entry.kind,
      label: r.entry.label,
      icon: r.entry.icon,
      summary: r.summary,
      payload: r.payload,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mem.ui, text, enabled, stale]);

  const options = useMemo<FastLaneView['options']>(() => {
    if (mem.ui.kind !== 'choose') return null;
    const [a, b] = mem.ui.options;
    const la = resolve(a, text, ref()).entry.label;
    const lb = resolve(b, text, ref()).entry.label;
    return [
      { intent: a, label: la },
      { intent: b, label: lb },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mem.ui, text]);

  const promote = useCallback(() => setMem((m) => promoteMem(m)), []);
  const choose = useCallback(
    (i: 0 | 1) => {
      setMem((m) => {
        if (m.ui.kind === 'choose') return force(m.ui.options[i], text);
        const intent = activeIntent(m.ui);
        return intent ? force(intent, text) : m;
      });
    },
    [text],
  );
  const dismiss = useCallback(() => {
    setDismissedFor(text);
    setMem(initialMemory);
  }, [text]);

  return { ui, resolved, options, placeable, promote, choose, dismiss };
}

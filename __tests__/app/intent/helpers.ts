import {
  INTENT_KEYS,
  type IntentKey,
  type IntentResult,
} from '../../../app/src/intent/types';

/**
 * Build an IntentResult from explicit probabilities. Whatever is not
 * assigned goes to `none`, so `probs({ event: 0.8 })` means 80% event,
 * 20% none. Mirrors shapeshift's test helper.
 */
export function probs(p: Partial<Record<IntentKey, number>>): IntentResult {
  const probabilities = Object.fromEntries(
    INTENT_KEYS.map((k) => [k, 0]),
  ) as Record<IntentKey, number>;
  let sum = 0;
  for (const [k, v] of Object.entries(p) as [IntentKey, number][]) {
    probabilities[k] = v;
    sum += v;
  }
  if (p.none === undefined) probabilities.none = Math.max(0, 1 - sum);
  // `value`/`confidence` reflect the intent(s) the caller explicitly named,
  // not the auto-filled `none` remainder: `probs({ event: 0.45 })` means
  // "45% confidence in event" per the doc comment above, not "event loses
  // to an implied 55% none". Deviation from the plan's literal helper body
  // (see final report) — without this, a lone sub-0.5 probability makes
  // the auto-filled `none` complement win the argmax.
  const explicit = Object.keys(p) as IntentKey[];
  const candidates = explicit.length ? explicit : (['none'] as IntentKey[]);
  let value: IntentKey = 'none';
  let confidence = -1;
  for (const k of INTENT_KEYS) {
    if (!candidates.includes(k)) continue;
    if (probabilities[k] > confidence) {
      value = k;
      confidence = probabilities[k];
    }
  }
  return { intent: { value, confidence, probabilities } };
}

export const REF = new Date('2026-09-26T09:00:00'); // a Saturday

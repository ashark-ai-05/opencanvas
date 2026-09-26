/**
 * Fast-lane intent contract. Pure data, no React, no stores.
 * Same shape as shapeshift's IntentResult so decide.ts ports unchanged.
 */
export const INTENT_KEYS = [
  'timer',
  'stopwatch',
  'clock',
  'todo',
  'reminder',
  'event',
  'note',
  'calc',
  'convert',
  'none',
] as const;
export type IntentKey = (typeof INTENT_KEYS)[number];
export type CardIntent = Exclude<IntentKey, 'none'>;
export const CARD_INTENTS = INTENT_KEYS.filter(
  (k): k is CardIntent => k !== 'none',
);

export type IntentResult = {
  intent: {
    value: IntentKey;
    confidence: number;
    probabilities: Record<IntentKey, number>;
  };
};

/**
 * Normalise raw non-negative scores into probabilities. Missing keys are 0.
 * If every score is 0 the result is 100% `none`.
 */
export function resultFromScores(
  scores: Partial<Record<IntentKey, number>>,
): IntentResult {
  const probabilities = Object.fromEntries(
    INTENT_KEYS.map((k) => [k, 0]),
  ) as Record<IntentKey, number>;
  let sum = 0;
  for (const k of INTENT_KEYS) {
    const v = Math.max(0, scores[k] ?? 0);
    probabilities[k] = v;
    sum += v;
  }
  if (sum === 0) {
    probabilities.none = 1;
    sum = 1;
  }
  let value: IntentKey = 'none';
  let confidence = -1;
  for (const k of INTENT_KEYS) {
    probabilities[k] = probabilities[k] / sum;
    if (probabilities[k] > confidence) {
      value = k;
      confidence = probabilities[k];
    }
  }
  return { intent: { value, confidence, probabilities } };
}

export const NONE_RESULT: IntentResult = resultFromScores({ none: 1 });

import { intentScores } from './keywords';
import { resultFromScores, type IntentResult } from './types';

export const MAX_FAST_LANE_CHARS = 140;

/** Text the fast lane must never classify (spec §3.4). */
export function isEscaped(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t.startsWith('/') || t.startsWith('@')) return true;
  if (t.includes('\n')) return true;
  if (t.length > MAX_FAST_LANE_CHARS) return true;
  return false;
}

export type ClassifyContext = { ref: Date };

export function classify(text: string, ctx: ClassifyContext): IntentResult {
  if (isEscaped(text)) return resultFromScores({ none: 1 });
  try {
    return resultFromScores(intentScores(text.trim(), ctx.ref));
  } catch {
    // A parser threw on odd input. Never let that reach the UI.
    return resultFromScores({ none: 1 });
  }
}

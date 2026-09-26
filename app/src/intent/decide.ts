import type { CardIntent, IntentKey, IntentResult } from './types';

/**
 * Calm-UI state machine, ported from anishfn/shapeshift (MIT).
 * Turns a flickery stream of classifier results into stable UI states:
 * a committed intent only changes when a challenger wins twice in a row
 * or is very sure.
 */
export type UiState =
  | { kind: 'input' }
  | { kind: 'ghost'; intent: CardIntent }
  | { kind: 'choose'; options: [CardIntent, CardIntent] }
  | { kind: 'committed'; intent: CardIntent; forced?: boolean };

export const THRESHOLDS = {
  inputBelow: 0.4,
  commitAt: 0.7,
  chooseGap: 0.15,
  chooseFloor: 0.25,
  challengerOverride: 0.85,
  challengerWins: 2,
  dropBelow: 0.3,
  forcedChangeRatio: 0.3,
} as const;

export type DecideMemory = {
  ui: UiState;
  /** A different intent currently beating the committed one. */
  challenger: { intent: CardIntent; wins: number } | null;
  /** Text at the moment the user forced an intent (chip / palette). */
  forcedText: string | null;
};

export const initialMemory: DecideMemory = {
  ui: { kind: 'input' },
  challenger: null,
  forcedText: null,
};

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

export function changedSubstantially(from: string, to: string): boolean {
  const len = Math.max(from.length, to.length, 1);
  return levenshtein(from, to) > THRESHOLDS.forcedChangeRatio * len;
}

function ranked(result: IntentResult): [IntentKey, number][] {
  return (
    Object.entries(result.intent.probabilities) as [IntentKey, number][]
  ).sort((a, b) => b[1] - a[1]);
}

/** Stateless mapping from a single result to a UI state. */
export function rawState(result: IntentResult): UiState {
  const top = result.intent.value;
  const conf = result.intent.confidence;
  if (top === 'none' || conf < THRESHOLDS.inputBelow) {
    const r = ranked(result).filter(([k]) => k !== 'none');
    if (top !== 'none' && r.length >= 2) {
      const [[a, pa], [b, pb]] = r;
      if (
        pa > THRESHOLDS.chooseFloor &&
        pb > THRESHOLDS.chooseFloor &&
        pa - pb < THRESHOLDS.chooseGap
      ) {
        return { kind: 'choose', options: [a as CardIntent, b as CardIntent] };
      }
    }
    return { kind: 'input' };
  }
  const r = ranked(result);
  if (r.length >= 2) {
    const [[a, pa], [b, pb]] = r;
    if (
      a !== 'none' &&
      b !== 'none' &&
      pa > THRESHOLDS.chooseFloor &&
      pb > THRESHOLDS.chooseFloor &&
      pa - pb < THRESHOLDS.chooseGap
    ) {
      return { kind: 'choose', options: [a as CardIntent, b as CardIntent] };
    }
  }
  if (conf < THRESHOLDS.commitAt) return { kind: 'ghost', intent: top };
  return { kind: 'committed', intent: top };
}

/**
 * Fold one result into memory. `text` is the text the result was
 * computed for.
 */
export function decide(
  mem: DecideMemory,
  result: IntentResult,
  text: string,
): DecideMemory {
  if (!text.trim()) return initialMemory;

  const prev = mem.ui;

  if (prev.kind === 'committed' && prev.forced && mem.forcedText !== null) {
    if (!changedSubstantially(mem.forcedText, text)) return mem;
  }

  const raw = rawState(result);

  if (prev.kind === 'committed' && !prev.forced) {
    const current = prev.intent;
    const top = result.intent.value;
    const topConf = result.intent.confidence;
    const currentP = result.intent.probabilities[current] ?? 0;

    if (top === current) return { ui: prev, challenger: null, forcedText: null };

    if (top === 'none') {
      if (currentP < THRESHOLDS.dropBelow) {
        return { ui: { kind: 'input' }, challenger: null, forcedText: null };
      }
      return { ...mem, challenger: null };
    }

    if (topConf >= THRESHOLDS.challengerOverride) {
      return { ui: { kind: 'committed', intent: top }, challenger: null, forcedText: null };
    }
    const wins = mem.challenger?.intent === top ? mem.challenger.wins + 1 : 1;
    if (wins >= THRESHOLDS.challengerWins && topConf >= THRESHOLDS.inputBelow) {
      return { ui: raw, challenger: null, forcedText: null };
    }
    if (currentP < THRESHOLDS.dropBelow && topConf < THRESHOLDS.inputBelow) {
      return { ui: { kind: 'input' }, challenger: null, forcedText: null };
    }
    return { ui: prev, challenger: { intent: top, wins }, forcedText: null };
  }

  return { ui: raw, challenger: null, forcedText: null };
}

/** User picked an intent from a chip. */
export function force(intent: CardIntent, text: string): DecideMemory {
  return {
    ui: { kind: 'committed', intent, forced: true },
    challenger: null,
    forcedText: text,
  };
}

/** Tab on a ghost: promote without locking. */
export function promote(mem: DecideMemory): DecideMemory {
  if (mem.ui.kind !== 'ghost') return mem;
  return { ui: { kind: 'committed', intent: mem.ui.intent }, challenger: null, forcedText: null };
}

export function activeIntent(ui: UiState): CardIntent | null {
  return ui.kind === 'committed' || ui.kind === 'ghost' ? ui.intent : null;
}

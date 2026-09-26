# Fast Lane Intent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognise utility prompts (timers, checklists, reminders, events, notes, calc, unit conversion) as the user types and place the matching widget locally on Enter, with no model call.

**Architecture:** A pure `app/src/intent/` module (keyword classifier, ported calm-UI state machine, one deterministic parser per intent, a registry mapping intents to existing widget kinds and payloads) feeds a `useFastLane` hook. A presentational chip in the composer status row shows the live state; the chat submit handler places the widget through the existing `applyToolDirective` path, records the preference signal, and leaves a local transcript note that never reaches the model.

**Tech Stack:** TypeScript, React 19, Zustand, vitest + jsdom + Testing Library, Zod (existing payload schemas), chrono-node (new, dates only), tldraw via the existing dispatcher.

**Spec:** `docs/plans/fast-lane-intent.md`

**Deviations from the spec (found during planning, both recorded in spec §9 by Task 1):**
1. `event` maps to `key-value-card`, not `calendar`. `calendar` is a plugin kind (`kind: 'plugin', pluginKind: 'calendar'`) whose renderer is fetched from `/v1/canvas/widget-kinds`; using it breaks the spec's "zero network, works with no backend" goal. A key-value card ("When / With / Mode / Where") is also a more compact event card than a month grid.
2. "Ask the model instead" is **Cmd/Ctrl+Enter**, not Shift+Enter. Shift+Enter already inserts a newline in the composer, and a newline already escapes the fast lane (spec §3.4), so that path still works; Mod+Enter adds the explicit bypass without changing existing behaviour.

## Global Constraints

- `app/src/intent/**` imports nothing from React, tldraw, or any Zustand store. Only `chrono-node`, `../../../src/agent/types` (types only) and sibling files.
- Every parser and the classifier are pure functions of `(text, referenceDate)`. No `new Date()` inside `app/src/intent/**`; the caller supplies `ref`.
- Widget kinds come from `WIDGET_KINDS` in `src/agent/types.ts` only. No new kinds. Payloads must pass `validatePayloadForKind` from `src/agent/payloads.ts`.
- Thresholds live in one exported `THRESHOLDS` object in `app/src/intent/decide.ts` (values copied from shapeshift: inputBelow 0.4, commitAt 0.7, chooseGap 0.15, chooseFloor 0.25, challengerOverride 0.85, challengerWins 2, dropBelow 0.3, forcedChangeRatio 0.3).
- Fast lane escapes (spec §3.4): text starting with `/` or `@`, longer than 140 characters, or containing a newline is never classified.
- Debounce is 120 ms. Classification is synchronous inside the debounce callback.
- Only new dependency: `chrono-node`, bundled into its own Vite chunk `vendor-chrono`.
- Tests are time-independent: every date test passes an explicit `ref` (`new Date('2026-09-26T09:00:00')`). Never call `new Date()` with no argument in a test.
- Both suites must stay green: `pnpm test` (backend) and `pnpm vitest run --config app/vite.config.ts` (app). `pnpm typecheck` clean.
- Commit after every task. Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Push direct to main with `git push https://oauth2:$(gh auth token)@github.com/ashark-ai-05/opencanvas.git main`.
- The setting defaults: local builds on, demo mode off (`fastLane: null` means "auto" = `!demo`).

## Review Focus

Inputs the spec implies but does not name. Each has its test pinned to the owning task.

1. **A question that contains a duration** ("how long is 25 min in seconds?") must classify `none`, not `timer`. A committed timer chip on a question would place a wrong widget on Enter. → Task 5 fixture.
2. **Whitespace and case** ("  25 MIN Timer  ") must classify and parse identically to "25 min timer". → Task 5 test.
3. **Unicode in checklist items** ("buy 🥛 milk, 🥚 eggs") must keep the items intact and not split on the emoji. → Task 3 test.
4. **Zero or absurd durations** ("0 min timer", "99999 hours") must not produce a payload; the chip must not commit. TimePayload accepts any non-negative int, so the parser must enforce 1 s ≤ duration ≤ 24 h. → Task 2 test.
5. **A weekday that already passed this week** ("standup with priya monday 10am" when `ref` is a Tuesday) must resolve to next Monday, never last Monday. → Task 4 test (`forwardDate: true`).

---

### Task 1: Intent types and the calm-UI state machine

**Files:**
- Create: `app/src/intent/types.ts`
- Create: `app/src/intent/decide.ts`
- Create: `__tests__/app/intent/helpers.ts`
- Test: `__tests__/app/intent/decide.test.ts`
- Modify: `docs/plans/fast-lane-intent.md` (§9, record the two deviations)

**Interfaces:**
- Produces: `INTENT_KEYS`, `IntentKey`, `CardIntent`, `CARD_INTENTS`, `IntentResult`, `resultFromScores(scores)`, `NONE_RESULT` from `types.ts`; `UiState`, `DecideMemory`, `THRESHOLDS`, `initialMemory`, `rawState`, `decide`, `force`, `promote`, `activeIntent`, `changedSubstantially`, `levenshtein` from `decide.ts`.

- [ ] **Step 1: Record the deviations in the spec**

Append to the end of §9 in `docs/plans/fast-lane-intent.md`:

```markdown
- **`event` → `key-value-card`, not `calendar` (planning change).** `calendar`
  is a plugin kind whose renderer is fetched from `/v1/canvas/widget-kinds`,
  which breaks the zero-network goal. A key-value card (When / With / Mode /
  Where) is compact and renders offline.
- **Bypass key is Cmd/Ctrl+Enter, not Shift+Enter (planning change).**
  Shift+Enter inserts a newline today; a newline already escapes the fast
  lane, so both paths reach the model. The chip says "⌘↵ ask model".
```

- [ ] **Step 2: Write the test helper**

`__tests__/app/intent/helpers.ts`:

```ts
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
  let value: IntentKey = 'none';
  let confidence = -1;
  for (const k of INTENT_KEYS) {
    if (probabilities[k] > confidence) {
      value = k;
      confidence = probabilities[k];
    }
  }
  return { intent: { value, confidence, probabilities } };
}

export const REF = new Date('2026-09-26T09:00:00'); // a Saturday
```

- [ ] **Step 3: Write the failing state-machine tests**

`__tests__/app/intent/decide.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  changedSubstantially,
  decide,
  force,
  initialMemory,
  promote,
  rawState,
  type DecideMemory,
} from '../../../app/src/intent/decide';
import { probs } from './helpers';

const run = (
  steps: [Parameters<typeof probs>[0], string][],
  start: DecideMemory = initialMemory,
) => {
  const states: DecideMemory[] = [];
  let mem = start;
  for (const [p, text] of steps) {
    mem = decide(mem, probs(p), text);
    states.push(mem);
  }
  return states;
};

describe('rawState thresholds', () => {
  it('none or low confidence → input', () => {
    expect(rawState(probs({ none: 0.9 })).kind).toBe('input');
    expect(rawState(probs({ event: 0.35, todo: 0.1 })).kind).toBe('input');
  });
  it('mid confidence → ghost', () => {
    expect(rawState(probs({ event: 0.55, todo: 0.2 }))).toEqual({ kind: 'ghost', intent: 'event' });
  });
  it('high confidence → committed', () => {
    expect(rawState(probs({ timer: 0.82 }))).toEqual({ kind: 'committed', intent: 'timer' });
  });
  it('close top two → choose', () => {
    expect(rawState(probs({ event: 0.42, reminder: 0.36 }))).toEqual({
      kind: 'choose',
      options: ['event', 'reminder'],
    });
  });
  it('close but one below floor → not choose', () => {
    expect(rawState(probs({ event: 0.3, reminder: 0.2 })).kind).toBe('input');
  });
});

describe('hysteresis', () => {
  it('a single challenger blip does not switch a committed intent', () => {
    const s = run([
      [{ event: 0.8 }, 'dinner with priya friday'],
      [{ reminder: 0.72, event: 0.2 }, 'dinner with priya friday 8'],
      [{ event: 0.78 }, 'dinner with priya friday 8pm'],
    ]);
    expect(s.map((m) => m.ui)).toEqual([
      { kind: 'committed', intent: 'event' },
      { kind: 'committed', intent: 'event' },
      { kind: 'committed', intent: 'event' },
    ]);
  });
  it('challenger wins twice → switch', () => {
    const s = run([
      [{ event: 0.8 }, 'call mom'],
      [{ reminder: 0.74, event: 0.2 }, 'call mom remind'],
      [{ reminder: 0.76, event: 0.2 }, 'call mom remind me'],
    ]);
    expect(s[1].ui).toEqual({ kind: 'committed', intent: 'event' });
    expect(s[2].ui).toEqual({ kind: 'committed', intent: 'reminder' });
  });
  it('strong challenger (≥0.85) switches immediately', () => {
    const s = run([
      [{ note: 0.75 }, 'note: 5 miles'],
      [{ convert: 0.9 }, 'note: 5 miles in km'],
    ]);
    expect(s[1].ui).toEqual({ kind: 'committed', intent: 'convert' });
  });
  it('alternating challengers never switch', () => {
    const s = run([
      [{ event: 0.8 }, 'a'],
      [{ todo: 0.7, event: 0.2 }, 'ab'],
      [{ reminder: 0.7, event: 0.2 }, 'abc'],
      [{ todo: 0.7, event: 0.2 }, 'abcd'],
      [{ reminder: 0.7, event: 0.2 }, 'abcde'],
    ]);
    expect(s.every((m) => m.ui.kind === 'committed' && m.ui.intent === 'event')).toBe(true);
  });
  it('committed → input only below 0.30', () => {
    const s = run([
      [{ event: 0.8 }, 'dinner friday'],
      [{ none: 0.5, event: 0.35 }, 'dinner fr'],
      [{ none: 0.8, event: 0.1 }, 'di'],
    ]);
    expect(s[1].ui.kind).toBe('committed');
    expect(s[2].ui.kind).toBe('input');
  });
  it('clearing text resets', () => {
    const s = run([
      [{ event: 0.8 }, 'dinner friday'],
      [{ event: 0.8 }, ''],
    ]);
    expect(s[1].ui.kind).toBe('input');
  });
  it('ghost ↔ input flicker is driven purely by thresholds', () => {
    const s = run([
      [{ event: 0.45 }, 'dinner'],
      [{ event: 0.5 }, 'dinner w'],
      [{ event: 0.72 }, 'dinner with'],
    ]);
    expect(s.map((m) => m.ui.kind)).toEqual(['ghost', 'ghost', 'committed']);
  });
});

describe('forced intents', () => {
  it('stay locked through small edits, release on big ones', () => {
    let mem = force('todo', 'milk eggs bread');
    mem = decide(mem, probs({ note: 0.9 }), 'milk eggs bread?');
    expect(mem.ui).toEqual({ kind: 'committed', intent: 'todo', forced: true });
    mem = decide(mem, probs({ note: 0.9 }), 'completely different text now');
    expect(mem.ui).toEqual({ kind: 'committed', intent: 'note' });
  });
  it('Levenshtein threshold at 30%', () => {
    expect(changedSubstantially('pizza or burgers', 'pizza or burger')).toBe(false);
    expect(changedSubstantially('abc', 'xyz')).toBe(true);
  });
  it('promote turns ghost into committed', () => {
    const mem = decide(initialMemory, probs({ todo: 0.5 }), 'milk, eggs');
    expect(promote(mem).ui).toEqual({ kind: 'committed', intent: 'todo' });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/intent/decide.test.ts`
Expected: FAIL, "Failed to resolve import ../../../app/src/intent/decide".

- [ ] **Step 5: Write `types.ts`**

`app/src/intent/types.ts`:

```ts
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
```

- [ ] **Step 6: Write `decide.ts` (port of shapeshift's `src/lib/decide.ts`, MIT)**

`app/src/intent/decide.ts`:

```ts
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
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/intent/decide.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 8: Commit**

```bash
git add app/src/intent/types.ts app/src/intent/decide.ts __tests__/app/intent/helpers.ts __tests__/app/intent/decide.test.ts docs/plans/fast-lane-intent.md
git commit -m "feat(intent): types + calm-UI state machine (ported from shapeshift, MIT)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Parsers — common helpers, timer, stopwatch, clock, time zones

**Files:**
- Create: `app/src/intent/parse/common.ts`
- Create: `app/src/intent/parse/timer.ts`
- Create: `app/src/intent/parse/stopwatch.ts`
- Create: `app/src/intent/parse/clock.ts`
- Create: `app/src/intent/zones.ts`
- Test: `__tests__/app/intent/parse-time.test.ts`

**Interfaces:**
- Produces: `collapse`, `tidy`, `capitalize`, `titleCase`, `toNumber`, `formatNumber`, `formatDuration` from `common.ts`; `parseTimer(text): TimerData`, `MAX_TIMER_SEC`; `parseStopwatch(text): StopwatchData`; `parseClock(text): ClockData`; `ZONES`, `findZone(text)` from `zones.ts`.

- [ ] **Step 1: Write the failing tests**

`__tests__/app/intent/parse-time.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  formatDuration,
  tidy,
  titleCase,
} from '../../../app/src/intent/parse/common';
import { parseTimer, MAX_TIMER_SEC } from '../../../app/src/intent/parse/timer';
import { parseStopwatch } from '../../../app/src/intent/parse/stopwatch';
import { parseClock } from '../../../app/src/intent/parse/clock';
import { findZone } from '../../../app/src/intent/zones';

describe('common', () => {
  it('tidy strips dangling connectors', () => {
    expect(tidy('focus for')).toBe('focus');
    expect(tidy('on the')).toBe('');
    expect(tidy(' , call bank ')).toBe('call bank');
  });
  it('titleCase', () => {
    expect(titleCase('standup with priya')).toBe('Standup With Priya');
  });
  it('formatDuration', () => {
    expect(formatDuration(1500)).toBe('25:00');
    expect(formatDuration(5)).toBe('00:05');
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});

describe('parseTimer', () => {
  it.each([
    ['25 min focus', 1500, 'Focus', false],
    ['25 min timer', 1500, '', false],
    ['1:30 timer', 90, '', false],
    ['set a timer for 2 hours', 7200, '', false],
    ['half an hour tea', 1800, 'Tea', false],
    ['90s', 90, '', false],
    ['1h 15m deep work', 4500, 'Deep work', false],
  ])('%s → %i s, label %j', (text, seconds, label) => {
    const d = parseTimer(text);
    expect(d.seconds).toBe(seconds);
    expect(d.label).toBe(label);
    expect(d.pomodoro).toBe(false);
  });
  it('pomodoro is a flag, not a duration', () => {
    const d = parseTimer('pomodoro');
    expect(d.pomodoro).toBe(true);
    expect(d.seconds).toBeNull();
  });
  it('no duration → null seconds', () => {
    expect(parseTimer('timer').seconds).toBeNull();
  });
  it('rejects zero and absurd durations (review focus 4)', () => {
    expect(parseTimer('0 min timer').seconds).toBeNull();
    expect(parseTimer('99999 hours').seconds).toBeNull();
    expect(MAX_TIMER_SEC).toBe(24 * 3600);
  });
});

describe('parseStopwatch', () => {
  it('extracts a label', () => {
    expect(parseStopwatch('start a stopwatch for the run').label).toBe('Run');
    expect(parseStopwatch('stopwatch').label).toBe('');
  });
});

describe('zones + parseClock', () => {
  it('findZone matches whole words, longest first', () => {
    expect(findZone('time in new york')?.tz).toBe('America/New_York');
    expect(findZone('3pm pst')?.tz).toBe('America/Los_Angeles');
    expect(findZone('pistachio')).toBeNull();
  });
  it('parseClock', () => {
    expect(parseClock('what time is it in tokyo')).toEqual({
      tz: 'Asia/Tokyo',
      place: 'Tokyo',
      format: null,
    });
    expect(parseClock('clock 24h')).toEqual({ tz: null, place: null, format: '24h' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/intent/parse-time.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Write `common.ts`**

`app/src/intent/parse/common.ts`:

```ts
export const capitalize = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

export const titleCase = (s: string): string =>
  s.split(/\s+/).filter(Boolean).map(capitalize).join(' ');

export const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Strip dangling connector words left behind after removing a phrase. */
export function tidy(s: string): string {
  let out = collapse(s.replace(/[,;]+\s*$/g, '').replace(/^\s*[,;:-]+/g, ''));
  const dangling =
    /\s+(on|at|by|for|with|to|in|and|the|this|next|from|every|a|an)$/i;
  const leading = /^(on|at|by|for|and|the|to|a|an)\s+/i;
  for (let i = 0; i < 4; i++) {
    const next = out.replace(dangling, '').replace(leading, '');
    if (next === out) break;
    out = next;
  }
  // A lone connector word ("on", "the") is nothing.
  if (/^(on|at|by|for|with|to|in|and|the|a|an)$/i.test(out)) return '';
  return out.trim();
}

export function toNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}

/** 1500 → "25:00", 3661 → "1:01:01". */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
```

- [ ] **Step 4: Write `timer.ts`**

`app/src/intent/parse/timer.ts`:

```ts
import { capitalize, collapse, tidy } from './common';

export type TimerData = {
  /** null when no valid duration (1 s … 24 h) was found. */
  seconds: number | null;
  label: string;
  pomodoro: boolean;
};

export const MAX_TIMER_SEC = 24 * 3600;

const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };

export function parseTimer(text: string): TimerData {
  let rest = ` ${collapse(text).toLowerCase()} `;
  let seconds = 0;
  let found = false;
  const pomodoro = /\bpomodoro\b/.test(rest);

  const special: [RegExp, number][] = [
    [/\bhalf an? hour\b/, 30 * 60],
    [/\ban? hour\b/, 60 * 60],
    [/\ba minute\b/, 60],
  ];
  for (const [re, s] of special) {
    if (re.test(rest)) {
      seconds += s;
      found = true;
      rest = rest.replace(re, ' ');
    }
  }

  rest = rest.replace(
    /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g,
    (_, n: string, u: string) => {
      seconds += Number(n) * UNIT[u[0]];
      found = true;
      return ' ';
    },
  );

  rest = rest.replace(/\b(\d{1,2}):(\d{2})\b/, (_, m: string, s: string) => {
    seconds += Number(m) * 60 + Number(s);
    found = true;
    return ' ';
  });

  const label = capitalize(
    tidy(rest.replace(/\b(?:timer|set|start|a|for|countdown|of|pomodoro)\b/g, ' ')),
  );

  const rounded = Math.round(seconds);
  const valid = found && rounded >= 1 && rounded <= MAX_TIMER_SEC;
  return { seconds: valid ? rounded : null, label, pomodoro };
}
```

- [ ] **Step 5: Write `stopwatch.ts`**

`app/src/intent/parse/stopwatch.ts`:

```ts
import { capitalize, collapse, tidy } from './common';

export type StopwatchData = { label: string };

export function parseStopwatch(text: string): StopwatchData {
  const rest = collapse(text)
    .toLowerCase()
    .replace(/\b(start|a|the|new|stopwatch|lap timer|timer|for|my)\b/g, ' ');
  return { label: capitalize(tidy(rest)) };
}
```

- [ ] **Step 6: Write `zones.ts`**

`app/src/intent/zones.ts`:

```ts
/** Lower-case place / abbreviation → IANA zone. Extend freely. */
export const ZONES: Record<string, string> = {
  utc: 'UTC',
  gmt: 'UTC',
  london: 'Europe/London',
  bst: 'Europe/London',
  paris: 'Europe/Paris',
  berlin: 'Europe/Berlin',
  cet: 'Europe/Berlin',
  madrid: 'Europe/Madrid',
  rome: 'Europe/Rome',
  amsterdam: 'Europe/Amsterdam',
  'new york': 'America/New_York',
  nyc: 'America/New_York',
  est: 'America/New_York',
  edt: 'America/New_York',
  toronto: 'America/Toronto',
  chicago: 'America/Chicago',
  cst: 'America/Chicago',
  denver: 'America/Denver',
  mst: 'America/Denver',
  'los angeles': 'America/Los_Angeles',
  la: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  sf: 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  pst: 'America/Los_Angeles',
  pdt: 'America/Los_Angeles',
  'sao paulo': 'America/Sao_Paulo',
  dubai: 'Asia/Dubai',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  bangalore: 'Asia/Kolkata',
  bengaluru: 'Asia/Kolkata',
  ist: 'Asia/Kolkata',
  singapore: 'Asia/Singapore',
  'hong kong': 'Asia/Hong_Kong',
  shanghai: 'Asia/Shanghai',
  beijing: 'Asia/Shanghai',
  seoul: 'Asia/Seoul',
  tokyo: 'Asia/Tokyo',
  jst: 'Asia/Tokyo',
  sydney: 'Australia/Sydney',
  melbourne: 'Australia/Melbourne',
  aest: 'Australia/Sydney',
  auckland: 'Pacific/Auckland',
};

const KEYS = Object.keys(ZONES).sort((a, b) => b.length - a.length);
const ZONE_RE = new RegExp(`\\b(${KEYS.join('|')})\\b`, 'i');

/** First (longest) zone word in `text`, or null. */
export function findZone(text: string): { key: string; tz: string } | null {
  const m = text.toLowerCase().match(ZONE_RE);
  if (!m) return null;
  const key = m[1].toLowerCase();
  return { key, tz: ZONES[key] };
}
```

- [ ] **Step 7: Write `clock.ts`**

`app/src/intent/parse/clock.ts`:

```ts
import { collapse, titleCase } from './common';
import { findZone } from '../zones';

export type ClockData = {
  tz: string | null;
  place: string | null;
  format: '12h' | '24h' | null;
};

export function parseClock(text: string): ClockData {
  const t = collapse(text).toLowerCase();
  const zone = findZone(t);
  const format = /\b(24h|24-hour|military)\b/.test(t)
    ? '24h'
    : /\b(12h|12-hour)\b/.test(t)
      ? '12h'
      : null;
  return {
    tz: zone?.tz ?? null,
    place: zone ? titleCase(zone.key) : null,
    format,
  };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/intent/parse-time.test.ts`
Expected: PASS. If the `'1h 15m deep work'` row fails on the label, the `\bm\b` unit is eating a letter; confirm the regex requires a digit before the unit (it does: `(\d+…)\s*(…)`).

- [ ] **Step 9: Commit**

```bash
git add app/src/intent/parse/common.ts app/src/intent/parse/timer.ts app/src/intent/parse/stopwatch.ts app/src/intent/parse/clock.ts app/src/intent/zones.ts __tests__/app/intent/parse-time.test.ts
git commit -m "feat(intent): timer, stopwatch, clock parsers + zone table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Parsers — todo, note, calc, convert

**Files:**
- Create: `app/src/intent/parse/todo.ts`
- Create: `app/src/intent/parse/note.ts`
- Create: `app/src/intent/parse/calc.ts`
- Create: `app/src/intent/parse/convert.ts`
- Test: `__tests__/app/intent/parse-text.test.ts`

**Interfaces:**
- Consumes: `common.ts` helpers from Task 2.
- Produces: `parseTodo(text): TodoData`, `parseNote(text): NoteData`, `parseCalc(text): CalcData`, `evaluate(expr): number | null`, `parseConvert(text): ConvertData | null`, `convertValue(value, from, to)`.

- [ ] **Step 1: Write the failing tests**

`__tests__/app/intent/parse-text.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseTodo } from '../../../app/src/intent/parse/todo';
import { parseNote } from '../../../app/src/intent/parse/note';
import { parseCalc, evaluate } from '../../../app/src/intent/parse/calc';
import { parseConvert } from '../../../app/src/intent/parse/convert';

describe('parseTodo', () => {
  it('splits on commas and "and", strips a leading verb', () => {
    const d = parseTodo('buy milk, eggs, bread and coffee');
    expect(d.items).toEqual(['Milk', 'Eggs', 'Bread', 'Coffee']);
    expect(d.verb).toBe('buy');
    expect(d.title).toBe('Shopping list');
    expect(d.explicit).toBe(true);
  });
  it('explicit prefix with semicolons', () => {
    const d = parseTodo('todo: call bank; renew passport');
    expect(d.items).toEqual(['Call bank', 'Renew passport']);
    expect(d.title).toBe('Checklist');
    expect(d.explicit).toBe(true);
  });
  it('keeps unicode items intact (review focus 3)', () => {
    expect(parseTodo('buy 🥛 milk, 🥚 eggs').items).toEqual(['🥛 milk', '🥚 eggs']);
  });
  it('a plain sentence is not explicit', () => {
    expect(parseTodo('explain this code').explicit).toBe(false);
  });
});

describe('parseNote', () => {
  it('requires a prefix', () => {
    expect(parseNote('note: the api key rotates monthly')).toEqual({
      body: 'The api key rotates monthly',
      explicit: true,
    });
    expect(parseNote('idea: canvas templates')).toEqual({ body: 'Canvas templates', explicit: true });
    expect(parseNote('the api key rotates monthly').explicit).toBe(false);
  });
});

describe('calc', () => {
  it('evaluate handles precedence, parens, unary minus', () => {
    expect(evaluate('2+3*4')).toBe(14);
    expect(evaluate('(2+3)*4')).toBe(20);
    expect(evaluate('-3+5')).toBe(2);
    expect(evaluate('10/4')).toBe(2.5);
    expect(evaluate('2+')).toBeNull();
    expect(evaluate('abc')).toBeNull();
  });
  it('percent of', () => {
    const d = parseCalc('18% of 3450');
    expect(d.result).toBeCloseTo(621);
    expect(d.expression).toBe('18% of 3,450');
  });
  it('split between', () => {
    const d = parseCalc('split 2400 between 3');
    expect(d.people).toBe(3);
    expect(d.each).toBe(800);
  });
  it('plain arithmetic with a question prefix', () => {
    expect(parseCalc('what is 2400 / 3?').result).toBe(800);
    expect(parseCalc('12 x 12').result).toBe(144);
  });
  it('prose is not calc', () => {
    expect(parseCalc('summarise the 3 docs').result).toBeNull();
  });
});

describe('parseConvert', () => {
  it('length', () => {
    const d = parseConvert('5 miles in km')!;
    expect(d.result).toBeCloseTo(8.047, 3);
    expect(d.from).toBe('mi');
    expect(d.to).toBe('km');
  });
  it('temperature', () => {
    expect(parseConvert('72f to c')!.result).toBeCloseTo(22.22, 2);
    expect(parseConvert('100 celsius in fahrenheit')!.result).toBe(212);
  });
  it('mismatched dimensions → null', () => {
    expect(parseConvert('5 kg to km')).toBeNull();
  });
  it('unknown unit → null', () => {
    expect(parseConvert('5 parsecs to km')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/intent/parse-text.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Write `todo.ts`**

`app/src/intent/parse/todo.ts`:

```ts
import { capitalize, collapse } from './common';

export type TodoData = {
  items: string[];
  verb: string | null;
  title: string;
  /** A list keyword or a shopping verb was present. */
  explicit: boolean;
};

const LEAD = /^(?:to ?do|to-do|todo list|checklist|list|shopping list|groceries)\s*:?\s*/i;
const VERB = /^(buy|get|pick up|grab|order)\s+/i;

export function parseTodo(text: string): TodoData {
  let rest = collapse(text.replace(/\n/g, ', '));
  let title = 'Checklist';
  let explicit = false;

  const lead = rest.match(LEAD);
  if (lead) {
    explicit = true;
    if (/shopping|groceries/i.test(lead[0])) title = 'Shopping list';
    rest = rest.slice(lead[0].length);
  }

  let verb: string | null = null;
  const vm = rest.match(VERB);
  if (vm) {
    verb = vm[1].toLowerCase();
    rest = rest.slice(vm[0].length);
    explicit = true;
    if (title === 'Checklist') title = 'Shopping list';
  }

  const items = rest
    .split(/\s*(?:,|;|\s&\s|\band\b)\s*/i)
    .map((s) =>
      s.trim().replace(/^(?:buy|get|also)\s+/i, '').replace(/[.!]+$/, ''),
    )
    .filter(Boolean)
    .map((s) => (/^[a-z]/i.test(s) ? capitalize(s) : s));

  return { items, verb, title, explicit };
}
```

- [ ] **Step 4: Write `note.ts`**

`app/src/intent/parse/note.ts`:

```ts
import { capitalize, collapse } from './common';

export type NoteData = { body: string; explicit: boolean };

const PREFIX = /^(?:note|idea|thought|memo|remember)\s*:\s*/i;

export function parseNote(text: string): NoteData {
  const t = collapse(text);
  const m = t.match(PREFIX);
  if (!m) return { body: t, explicit: false };
  return { body: capitalize(t.slice(m[0].length)), explicit: true };
}
```

- [ ] **Step 5: Write `calc.ts`**

`app/src/intent/parse/calc.ts`:

```ts
import { collapse, formatNumber, toNumber } from './common';

export type CalcData = {
  expression: string;
  result: number | null;
  people: number | null;
  each: number | null;
};

const EMPTY = (expression: string): CalcData => ({
  expression,
  result: null,
  people: null,
  each: null,
});

const SPLIT =
  /\bsplit\s+([\d,]+(?:\.\d+)?)\s*(?:between|among|across|by|\/)\s*(\d+)(?:\s*(?:people|ways|persons|friends))?/i;
const PERCENT = /(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?([\d,]+(?:\.\d+)?)/i;

/**
 * Tiny recursive-descent evaluator for + - * / ( ) and unary minus.
 * Returns null on any syntax error. Never uses eval.
 */
export function evaluate(expr: string): number | null {
  const s = expr.replace(/\s+/g, '');
  let i = 0;
  const peek = () => s[i];
  const next = () => s[i++];

  function number(): number | null {
    const m = s.slice(i).match(/^\d+(?:\.\d+)?/);
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  }
  function factor(): number | null {
    if (peek() === '(') {
      next();
      const v = sum();
      if (peek() !== ')') return null;
      next();
      return v;
    }
    if (peek() === '-') {
      next();
      const v = factor();
      return v === null ? null : -v;
    }
    return number();
  }
  function product(): number | null {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = next();
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function sum(): number | null {
    let v = product();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = next();
      const r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  const v = sum();
  return i === s.length && v !== null && Number.isFinite(v) ? v : null;
}

export function parseCalc(text: string): CalcData {
  const t = collapse(text)
    .toLowerCase()
    .replace(/^(?:what(?:'s| is)|calc(?:ulate)?|compute|how much is)\s+/, '')
    .replace(/[?=]+\s*$/, '')
    .trim();

  const s = t.match(SPLIT);
  if (s) {
    const amount = toNumber(s[1]);
    const people = Number(s[2]);
    if (people > 0) {
      return {
        expression: `${formatNumber(amount)} ÷ ${people}`,
        result: amount,
        people,
        each: amount / people,
      };
    }
  }

  const p = t.match(PERCENT);
  if (p) {
    const pct = Number(p[1]);
    const base = toNumber(p[2]);
    return {
      expression: `${pct}% of ${formatNumber(base)}`,
      result: (pct / 100) * base,
      people: null,
      each: null,
    };
  }

  const expr = t
    .replace(/(\d)\s*[x×]\s*(\d)/g, '$1*$2')
    .replace(/÷/g, '/')
    .replace(/,/g, '');
  if (!/^[\d\s+\-*/().]+$/.test(expr) || !/[+\-*/]/.test(expr) || !/\d/.test(expr)) {
    return EMPTY(t);
  }
  const result = evaluate(expr);
  return result === null ? EMPTY(t) : { expression: collapse(t), result, people: null, each: null };
}
```

- [ ] **Step 6: Write `convert.ts`**

`app/src/intent/parse/convert.ts`:

```ts
import { collapse, toNumber } from './common';

type Dim = 'length' | 'mass' | 'volume' | 'speed' | 'temp';
type Unit = { dim: Dim; factor: number; label: string };

/** Canonical units. `factor` converts to the dimension's base unit. */
const UNITS: Record<string, Unit> = {
  mm: { dim: 'length', factor: 0.001, label: 'mm' },
  cm: { dim: 'length', factor: 0.01, label: 'cm' },
  m: { dim: 'length', factor: 1, label: 'm' },
  km: { dim: 'length', factor: 1000, label: 'km' },
  in: { dim: 'length', factor: 0.0254, label: 'in' },
  ft: { dim: 'length', factor: 0.3048, label: 'ft' },
  yd: { dim: 'length', factor: 0.9144, label: 'yd' },
  mi: { dim: 'length', factor: 1609.344, label: 'mi' },
  g: { dim: 'mass', factor: 0.001, label: 'g' },
  kg: { dim: 'mass', factor: 1, label: 'kg' },
  lb: { dim: 'mass', factor: 0.45359237, label: 'lb' },
  oz: { dim: 'mass', factor: 0.028349523, label: 'oz' },
  ml: { dim: 'volume', factor: 0.001, label: 'ml' },
  l: { dim: 'volume', factor: 1, label: 'L' },
  gal: { dim: 'volume', factor: 3.785411784, label: 'gal' },
  cup: { dim: 'volume', factor: 0.2365882365, label: 'cup' },
  kph: { dim: 'speed', factor: 1000 / 3600, label: 'km/h' },
  mph: { dim: 'speed', factor: 1609.344 / 3600, label: 'mph' },
  c: { dim: 'temp', factor: 1, label: '°C' },
  f: { dim: 'temp', factor: 1, label: '°F' },
  k: { dim: 'temp', factor: 1, label: 'K' },
};

const ALIASES: Record<string, string> = {
  millimeter: 'mm', millimeters: 'mm', millimetre: 'mm', millimetres: 'mm',
  centimeter: 'cm', centimeters: 'cm', centimetre: 'cm', centimetres: 'cm',
  meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  kilometer: 'km', kilometers: 'km', kilometre: 'km', kilometres: 'km', kms: 'km',
  inch: 'in', inches: 'in', foot: 'ft', feet: 'ft', yard: 'yd', yards: 'yd',
  mile: 'mi', miles: 'mi',
  gram: 'g', grams: 'g', kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg', kgs: 'kg',
  pound: 'lb', pounds: 'lb', lbs: 'lb', ounce: 'oz', ounces: 'oz',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  gallon: 'gal', gallons: 'gal', cups: 'cup',
  'km/h': 'kph', kmh: 'kph', kmph: 'kph',
  celsius: 'c', '°c': 'c', fahrenheit: 'f', '°f': 'f', kelvin: 'k',
};

function unit(raw: string): string | null {
  const key = raw.toLowerCase();
  if (UNITS[key]) return key;
  const alias = ALIASES[key];
  return alias && UNITS[alias] ? alias : null;
}

export type ConvertData = {
  value: number;
  from: string;
  to: string;
  result: number | null;
  expression: string;
};

function temp(value: number, from: string, to: string): number {
  const c =
    from === 'c' ? value : from === 'f' ? ((value - 32) * 5) / 9 : value - 273.15;
  return to === 'c' ? c : to === 'f' ? (c * 9) / 5 + 32 : c + 273.15;
}

/** Returns null when either unit is unknown or the dimensions differ. */
export function convertValue(value: number, from: string, to: string): number | null {
  const a = UNITS[from];
  const b = UNITS[to];
  if (!a || !b || a.dim !== b.dim) return null;
  if (a.dim === 'temp') return temp(value, from, to);
  return (value * a.factor) / b.factor;
}

const RE =
  /(\d[\d,]*(?:\.\d+)?)\s*°?\s*([a-z°/]+)\s+(?:to|in|into|as)\s+°?\s*([a-z°/]+)\b/i;

export function parseConvert(text: string): ConvertData | null {
  const t = collapse(text).toLowerCase().replace(/[?]+\s*$/, '');
  const m = t.match(RE);
  if (!m) return null;
  const from = unit(m[2]);
  const to = unit(m[3]);
  if (!from || !to) return null;
  const value = toNumber(m[1]);
  const result = convertValue(value, from, to);
  if (result === null) return null;
  return {
    value,
    from,
    to,
    result,
    expression: `${m[1]} ${UNITS[from].label} → ${UNITS[to].label}`,
  };
}

export function unitLabel(key: string): string {
  return UNITS[key]?.label ?? key;
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/intent/parse-text.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add app/src/intent/parse/todo.ts app/src/intent/parse/note.ts app/src/intent/parse/calc.ts app/src/intent/parse/convert.ts __tests__/app/intent/parse-text.test.ts
git commit -m "feat(intent): todo, note, calc, convert parsers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Date parsers — reminder and event (adds chrono-node)

**Files:**
- Modify: `package.json` (dependency), `pnpm-lock.yaml` (via install)
- Modify: `app/vite.config.ts:64-66` (add `vendor-chrono` chunk before the tldraw branch)
- Create: `app/src/intent/parse/dates.ts`
- Create: `app/src/intent/parse/reminder.ts`
- Create: `app/src/intent/parse/event.ts`
- Test: `__tests__/app/intent/parse-dates.test.ts`

**Interfaces:**
- Produces: `firstDate(text, ref): DateHit | null`, `isoDate(d)`, `hhmm(d)`, `humanWhen(d, hasTime)`; `parseReminder(text, ref): ReminderData`; `parseEvent(text, ref): EventData`.

- [ ] **Step 1: Add the dependency and the chunk**

```bash
pnpm add chrono-node@^2.10.1
```

In `app/vite.config.ts`, inside `manualChunks`, add as the first check after the `node_modules` guard:

```ts
          if (id.includes('/chrono-node/')) {
            return 'vendor-chrono';
          }
```

- [ ] **Step 2: Write the failing tests**

`__tests__/app/intent/parse-dates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { firstDate, isoDate } from '../../../app/src/intent/parse/dates';
import { parseReminder } from '../../../app/src/intent/parse/reminder';
import { parseEvent } from '../../../app/src/intent/parse/event';
import { REF } from './helpers'; // 2026-09-26T09:00 local, a Saturday

describe('dates', () => {
  it('firstDate finds a forward date and whether it has a time', () => {
    const h = firstDate('pay rent friday', REF)!;
    expect(isoDate(h.date)).toBe('2026-10-02');
    expect(h.hasTime).toBe(false);
    expect(h.text).toBe('friday');
  });
  it('a weekday already passed resolves forward (review focus 5)', () => {
    const tue = new Date('2026-09-29T09:00:00');
    expect(isoDate(firstDate('standup monday 10am', tue)!.date)).toBe('2026-10-05');
  });
  it('no date → null', () => {
    expect(firstDate('buy milk', REF)).toBeNull();
  });
});

describe('parseReminder', () => {
  it('strips the trigger phrase and the date', () => {
    expect(parseReminder('remind me to pay rent friday', REF)).toEqual({
      task: 'Pay rent',
      due: '2026-10-02',
      time: null,
    });
  });
  it('keeps a time when given', () => {
    const d = parseReminder("don't forget to call mom tomorrow at 6pm", REF);
    expect(d.task).toBe('Call mom');
    expect(d.due).toBe('2026-09-27');
    expect(d.time).toBe('18:00');
  });
  it('no date → due null', () => {
    expect(parseReminder('remind me to breathe', REF).due).toBeNull();
  });
});

describe('parseEvent', () => {
  it('title, attendees, mode, date, time', () => {
    const d = parseEvent('standup with priya tomorrow 10am on zoom', REF);
    expect(d.title).toBe('Standup');
    expect(d.attendees).toEqual(['Priya']);
    expect(d.mode).toBe('video');
    expect(d.date).toBe('2026-09-27');
    expect(d.time).toBe('10:00');
    expect(d.when).toMatch(/Sun 27 Sep.*10:00/);
  });
  it('multiple attendees and a place', () => {
    const d = parseEvent('lunch with rahul and anna at the corner cafe friday', REF);
    expect(d.attendees).toEqual(['Rahul', 'Anna']);
    expect(d.place).toBe('Corner Cafe');
    expect(d.title).toBe('Lunch');
  });
  it('no date → date null', () => {
    expect(parseEvent('coffee with sam', REF).date).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/intent/parse-dates.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 4: Write `dates.ts`**

`app/src/intent/parse/dates.ts`:

```ts
import * as chrono from 'chrono-node';

export type DateHit = {
  date: Date;
  hasTime: boolean;
  /** The matched substring, so callers can remove it. */
  text: string;
  index: number;
};

/** First date in `text`, always resolved forward from `ref`. */
export function firstDate(text: string, ref: Date): DateHit | null {
  const results = chrono.parse(text, ref, { forwardDate: true });
  const r = results[0];
  if (!r) return null;
  return {
    date: r.start.date(),
    hasTime: r.start.isCertain('hour'),
    text: r.text,
    index: r.index,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local YYYY-MM-DD (not UTC — a 10pm local event must not roll to tomorrow). */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sun 27 Sep, 10:00" or "Fri 2 Oct". */
export function humanWhen(d: Date, hasTime: boolean): string {
  const base = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return hasTime ? `${base}, ${hhmm(d)}` : base;
}

/** Remove the matched date text from `text`. */
export function withoutDate(text: string, hit: DateHit): string {
  return text.slice(0, hit.index) + ' ' + text.slice(hit.index + hit.text.length);
}
```

- [ ] **Step 5: Write `reminder.ts`**

`app/src/intent/parse/reminder.ts`:

```ts
import { capitalize, collapse, tidy } from './common';
import { firstDate, hhmm, isoDate, withoutDate } from './dates';

export type ReminderData = {
  task: string;
  /** YYYY-MM-DD local, or null. */
  due: string | null;
  /** HH:mm local when the text named a time. */
  time: string | null;
};

const TRIGGER =
  /^(?:remind me (?:to|about|of)?|reminder\s*:?|don'?t forget (?:to)?|remember (?:to)?)\s*/i;

export function parseReminder(text: string, ref: Date): ReminderData {
  let t = collapse(text).replace(TRIGGER, '');
  const hit = firstDate(t, ref);
  if (hit) t = withoutDate(t, hit);
  return {
    task: capitalize(tidy(t)),
    due: hit ? isoDate(hit.date) : null,
    time: hit?.hasTime ? hhmm(hit.date) : null,
  };
}
```

- [ ] **Step 6: Write `event.ts`**

`app/src/intent/parse/event.ts`:

```ts
import { capitalize, collapse, tidy, titleCase } from './common';
import { firstDate, hhmm, humanWhen, isoDate, withoutDate } from './dates';

export type EventData = {
  title: string;
  date: string | null;
  time: string | null;
  /** Human "Sun 27 Sep, 10:00" for display. */
  when: string | null;
  attendees: string[];
  mode: 'video' | 'phone' | null;
  place: string | null;
};

const VIDEO = /\b(zoom|google meet|meet|teams|facetime|video call|video)\b/i;
const PHONE = /\b(phone|call)\b/i;
const MODE_PHRASE = /\b(?:on|via|over)\s+(?:zoom|google meet|meet|teams|facetime|video call|video|phone)\b/gi;
const WITH = /\bwith\s+([A-Za-z]+(?:(?:,\s*|\s+and\s+|\s*&\s*)[A-Za-z]+)*)/i;
const PLACE = /\b(?:at|in)\s+(?:the\s+)?([A-Za-z][A-Za-z' ]{1,30})$/i;

export function parseEvent(text: string, ref: Date): EventData {
  let t = collapse(text);
  const hit = firstDate(t, ref);
  if (hit) t = withoutDate(t, hit);

  let mode: EventData['mode'] = null;
  if (VIDEO.test(t)) mode = 'video';
  else if (PHONE.test(t)) mode = 'phone';
  t = t.replace(MODE_PHRASE, ' ');

  const attendees: string[] = [];
  const wm = t.match(WITH);
  if (wm) {
    attendees.push(...wm[1].split(/,\s*|\s+and\s+|\s*&\s*/i).map(capitalize));
    t = t.replace(wm[0], ' ');
  }

  let place: string | null = null;
  const pm = collapse(t).match(PLACE);
  if (pm) {
    place = titleCase(pm[1].trim());
    t = collapse(t).slice(0, pm.index);
  }

  const title = titleCase(tidy(t)) || 'Event';
  return {
    title,
    date: hit ? isoDate(hit.date) : null,
    time: hit?.hasTime ? hhmm(hit.date) : null,
    when: hit ? humanWhen(hit.date, hit.hasTime) : null,
    attendees,
    mode,
    place,
  };
}
```

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/intent/parse-dates.test.ts`
Expected: PASS. If chrono returns `hasTime: true` for "friday", check you passed `forwardDate` in the options object, not as a third positional string.

- [ ] **Step 8: Confirm the chunk exists**

Run: `pnpm app:build 2>&1 | grep -E "vendor-chrono|error"`
Expected: one `vendor-chrono-*.js` line, no errors.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml app/vite.config.ts app/src/intent/parse/dates.ts app/src/intent/parse/reminder.ts app/src/intent/parse/event.ts __tests__/app/intent/parse-dates.test.ts
git commit -m "feat(intent): reminder + event parsers on chrono-node (own vendor chunk)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Keyword classifier

**Files:**
- Create: `app/src/intent/keywords.ts`
- Create: `app/src/intent/classify.ts`
- Test: `__tests__/app/intent/classify.test.ts`

**Interfaces:**
- Consumes: every parser from Tasks 2–4, `resultFromScores` from Task 1.
- Produces: `classify(text, ctx: { ref: Date }): IntentResult`; `isEscaped(text): boolean`; `MAX_FAST_LANE_CHARS = 140`.

- [ ] **Step 1: Write the failing fixture test**

`__tests__/app/intent/classify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classify, isEscaped } from '../../../app/src/intent/classify';
import type { IntentKey } from '../../../app/src/intent/types';
import { REF } from './helpers';

const top = (text: string) => classify(text, { ref: REF }).intent.value;
const conf = (text: string) => classify(text, { ref: REF }).intent.confidence;

/** [utterance, expected top intent]. The `none` rows are the ones that matter most. */
const FIXTURE: [string, IntentKey][] = [
  // timer
  ['25 min focus', 'timer'],
  ['25 min timer', 'timer'],
  ['set a timer for 2 hours', 'timer'],
  ['pomodoro', 'timer'],
  ['1:30 countdown', 'timer'],
  ['90s', 'timer'],
  // stopwatch
  ['stopwatch', 'stopwatch'],
  ['start a stopwatch for the run', 'stopwatch'],
  // clock
  ['what time is it in tokyo', 'clock'],
  ['time in new york', 'clock'],
  ['clock pst', 'clock'],
  // todo
  ['buy milk, eggs, bread and coffee', 'todo'],
  ['todo: call bank; renew passport', 'todo'],
  ['shopping list: rice, dal', 'todo'],
  ['checklist: passport, charger, adapter', 'todo'],
  // reminder
  ['remind me to pay rent friday', 'reminder'],
  ["don't forget to call mom tomorrow", 'reminder'],
  ['reminder: submit timesheet', 'reminder'],
  // event
  ['standup with priya tomorrow 10am on zoom', 'event'],
  ['lunch with rahul and anna friday', 'event'],
  ['dentist appointment monday 3pm', 'event'],
  ['coffee with sam next tuesday', 'event'],
  // note
  ['note: the api key rotates monthly', 'note'],
  ['idea: canvas templates for retros', 'note'],
  // calc
  ['18% of 3450', 'calc'],
  ['split 2400 between 3', 'calc'],
  ['what is 2400 / 3', 'calc'],
  ['12 x 12', 'calc'],
  // convert
  ['5 miles in km', 'convert'],
  ['72f to c', 'convert'],
  ['100 celsius in fahrenheit', 'convert'],
  // none — conversation, questions, anything a model should answer
  ['what is the capital of peru', 'none'],
  ['explain this code', 'none'],
  ['summarise the doc', 'none'],
  ['why is the build failing', 'none'],
  ['how long is 25 min in seconds?', 'none'], // review focus 1
  ['tell me about the unified agent', 'none'],
  ['make a chart of sales by region', 'none'],
  ['what did we decide about auth', 'none'],
  ['compare hono and express', 'none'],
  ['write a haiku about timers', 'none'],
  ['the api key rotates monthly', 'none'], // no note prefix
  ['milk', 'none'], // one item is not a list
  ['tomorrow', 'none'],
  ['call', 'none'],
  ['5', 'none'],
  ['', 'none'],
  ['a', 'none'],
  ['what time', 'none'], // no zone, no clock keyword yet
  ['plan my week', 'none'],
  ['show me a kanban for the launch', 'none'],
];

describe('classify fixture', () => {
  it.each(FIXTURE)('%j → %s', (text, expected) => {
    expect(top(text)).toBe(expected);
  });

  it('every non-none row is at least a ghost (≥0.4)', () => {
    for (const [text, expected] of FIXTURE) {
      if (expected === 'none') continue;
      expect(conf(text), text).toBeGreaterThanOrEqual(0.4);
    }
  });

  it('whitespace and case do not change the answer (review focus 2)', () => {
    expect(classify('  25 MIN Timer  ', { ref: REF })).toEqual(
      classify('25 min timer', { ref: REF }),
    );
  });

  it('probabilities sum to 1', () => {
    const p = classify('buy milk, eggs', { ref: REF }).intent.probabilities;
    const sum = Object.values(p).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });
});

describe('isEscaped', () => {
  it('slash, at, newline, too long, empty', () => {
    expect(isEscaped('/clear')).toBe(true);
    expect(isEscaped('@sam ping')).toBe(true);
    expect(isEscaped('line one\nline two')).toBe(true);
    expect(isEscaped('x'.repeat(141))).toBe(true);
    expect(isEscaped('   ')).toBe(true);
    expect(isEscaped('25 min timer')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/intent/classify.test.ts`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Write `keywords.ts`**

`app/src/intent/keywords.ts`:

```ts
import type { IntentKey } from './types';
import { parseTimer } from './parse/timer';
import { parseTodo } from './parse/todo';
import { parseNote } from './parse/note';
import { parseCalc } from './parse/calc';
import { parseConvert } from './parse/convert';
import { firstDate } from './parse/dates';
import { findZone } from './zones';

export type Scores = Partial<Record<IntentKey, number>>;

const has = (re: RegExp, t: string) => re.test(t);

const QUESTION = /^(what|why|how|who|where|when|which|explain|summari[sz]e|describe|tell me|compare|show me|make|create|write|draft|plan|list the|find)\b/;
const GATHER = /\b(meeting|meet|standup|stand-up|sync|lunch|dinner|breakfast|brunch|coffee|call|interview|appointment|1:1|one on one|party|drinks|catch ?up|demo|review)\b/;
const REMIND = /\b(remind me|reminder|don'?t forget|remember to)\b/;
const CLOCK_WORD = /\b(clock|current time|local time)\b/;
const TIME_QUERY = /\b(what time|what'?s the time|time in)\b/;

/**
 * Additive keyword evidence per intent. `none` carries a base weight so a
 * single weak signal stays below the ghost threshold. Parsers are
 * consulted for the strongest evidence ("a duration parsed" beats "the
 * word timer appeared").
 */
export function intentScores(raw: string, ref: Date): Scores {
  const t = raw.toLowerCase().trim();
  const words = t.split(/\s+/).filter(Boolean);
  const s: Scores = { none: 2.5 };
  const add = (k: IntentKey, v: number) => (s[k] = (s[k] ?? 0) + v);

  if (words.length === 0) return { none: 1 };
  if (words.length > 14) add('none', 3);
  const isQuestion = has(QUESTION, t) || t.endsWith('?');
  if (isQuestion) add('none', 3);

  // Deterministic parsers first: a full parse is strong evidence.
  const conv = parseConvert(t);
  if (conv?.result != null) add('convert', 8);

  const calc = parseCalc(t);
  if (calc.result != null && !conv) add('calc', 7);

  const timer = parseTimer(t);
  const stopwatch = has(/\bstopwatch\b/, t);
  if (!stopwatch && !conv && !calc.result) {
    if (has(/\b(timer|countdown|focus session)\b/, t)) add('timer', 4);
    if (timer.seconds != null) add('timer', 4);
    // "25 min focus" / "10 min break": a duration plus an activity word commits.
    if (timer.seconds != null && has(/\b(focus|break|nap|rest|meditat\w*|workout|study)\b/, t)) add('timer', 3);
    if (timer.pomodoro) add('timer', 7);
  }
  if (stopwatch) add('stopwatch', 8);

  const zone = findZone(t);
  const clockWord = has(CLOCK_WORD, t);
  if (clockWord) add('clock', 5);
  // A zone name plus any time word is a clock; "what time" alone is not.
  if (zone && (clockWord || has(TIME_QUERY, t) || has(/\btime\b/, t))) add('clock', 8);

  const todo = parseTodo(t);
  const hasSep = /[,;]/.test(t);
  if (todo.explicit && todo.items.length >= 1) add('todo', 5);
  // "compare hono and express" splits on "and" but is not a list; need a comma or a keyword.
  if (todo.items.length >= 2 && (todo.explicit || hasSep)) add('todo', 3);
  if (todo.items.length >= 3 && (todo.explicit || hasSep)) add('todo', 1);

  const note = parseNote(t);
  if (note.explicit) add('note', 9);

  const date = firstDate(t, ref);
  if (has(REMIND, t)) {
    add('reminder', 7);
    if (date) add('reminder', 2);
  }

  if (has(GATHER, t)) add('event', 2); // alone this stays below the `none` floor (2.5)
  if (has(/\bwith\s+[a-z]/, t)) add('event', 2);
  if (date && (has(GATHER, t) || has(/\bwith\s+[a-z]/, t))) add('event', 3);
  if (date && date.hasTime && has(GATHER, t)) add('event', 1);
  if (has(REMIND, t) && s.event) s.event = s.event * 0.3;

  // A question overrides utility intents unless a parser fully succeeded.
  if (isQuestion && !conv && calc.result == null && !s.clock) {
    for (const k of ['timer', 'todo', 'event', 'reminder'] as const) {
      if (s[k]) s[k] = s[k]! * 0.4;
    }
  }

  return s;
}
```

- [ ] **Step 4: Write `classify.ts`**

`app/src/intent/classify.ts`:

```ts
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
```

- [ ] **Step 5: Run and tune**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/intent/classify.test.ts`
Expected: PASS. If a `none` row flips, raise the `none` base or the question penalty; if a positive row drops below 0.4, raise that intent's parser bonus. Change weights in `keywords.ts` only; never edit the fixture to fit the weights.

- [ ] **Step 6: Commit**

```bash
git add app/src/intent/keywords.ts app/src/intent/classify.ts __tests__/app/intent/classify.test.ts
git commit -m "feat(intent): keyword classifier with 50-utterance fixture

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Registry — intent → kind, summary, payload

**Files:**
- Create: `app/src/intent/registry.ts`
- Test: `__tests__/app/intent/registry.test.ts`

**Interfaces:**
- Consumes: all parsers; `WidgetKind` from `src/agent/types.ts`; `validatePayloadForKind` from `src/agent/payloads.ts` (test only).
- Produces: `IconName`, `IntentEntry<D>`, `INTENTS: Record<CardIntent, IntentEntry>`, `resolve(intent, text, ref): Resolved`.

- [ ] **Step 1: Write the failing tests**

`__tests__/app/intent/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { INTENTS, resolve } from '../../../app/src/intent/registry';
import { CARD_INTENTS } from '../../../app/src/intent/types';
import { validatePayloadForKind } from '../../../src/agent/payloads';
import { REF } from './helpers';

const EXAMPLES: Record<string, string> = {
  timer: '25 min focus',
  stopwatch: 'stopwatch for the run',
  clock: 'time in tokyo',
  todo: 'buy milk, eggs, bread',
  reminder: 'remind me to pay rent friday',
  event: 'standup with priya tomorrow 10am on zoom',
  note: 'note: the api key rotates monthly',
  calc: '18% of 3450',
  convert: '5 miles in km',
};

describe('registry', () => {
  it('covers every card intent', () => {
    for (const k of CARD_INTENTS) expect(INTENTS[k], k).toBeDefined();
  });

  it.each(CARD_INTENTS)('%s: example payload passes the kind schema', (intent) => {
    const r = resolve(intent, EXAMPLES[intent], REF);
    expect(r.complete, intent).toBe(true);
    expect(r.payload, intent).not.toBeNull();
    expect(() => validatePayloadForKind(r.entry.kind, r.payload)).not.toThrow();
    expect(r.summary.length).toBeGreaterThan(0);
  });

  it('timer summary and payload', () => {
    const r = resolve('timer', '25 min focus', REF);
    expect(r.summary).toBe('Timer 25:00 · Focus');
    expect(r.payload).toEqual({ mode: 'timer', durationSec: 1500, label: 'Focus' });
  });
  it('pomodoro payload pins work/break seconds', () => {
    expect(resolve('timer', 'pomodoro', REF).payload).toEqual({
      mode: 'pomodoro',
      pomodoro: { workSec: 1500, breakSec: 300 },
    });
  });
  it('incomplete data → null payload', () => {
    expect(resolve('timer', 'timer', REF).payload).toBeNull();
    expect(resolve('event', 'coffee with sam', REF).payload).toBeNull();
    expect(resolve('todo', 'milk', REF).payload).toBeNull();
  });
  it('event maps to a key-value card', () => {
    const r = resolve('event', 'standup with priya tomorrow 10am on zoom', REF);
    expect(r.entry.kind).toBe('key-value-card');
    expect(r.payload).toMatchObject({
      title: 'Standup with Priya',
      fields: expect.arrayContaining([
        { key: 'When', value: expect.stringMatching(/Sun 27 Sep, 10:00/) },
        { key: 'Mode', value: 'Video' },
        { key: 'With', value: 'Priya' },
      ]),
    });
  });
  it('reminder maps to tasks with a due date', () => {
    expect(resolve('reminder', 'remind me to pay rent friday', REF).payload).toEqual({
      title: 'Reminder',
      items: [{ text: 'Pay rent', due: '2026-10-02' }],
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/intent/registry.test.ts`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Write `registry.ts`**

`app/src/intent/registry.ts`:

```ts
import type { WidgetKind } from '../../../src/agent/types';
import type { CardIntent } from './types';
import { formatDuration, formatNumber, titleCase } from './parse/common';
import { parseTimer, type TimerData } from './parse/timer';
import { parseStopwatch, type StopwatchData } from './parse/stopwatch';
import { parseClock, type ClockData } from './parse/clock';
import { parseTodo, type TodoData } from './parse/todo';
import { parseReminder, type ReminderData } from './parse/reminder';
import { parseEvent, type EventData } from './parse/event';
import { parseNote, type NoteData } from './parse/note';
import { parseCalc, type CalcData } from './parse/calc';
import { parseConvert, unitLabel, type ConvertData } from './parse/convert';

/** Icon names are resolved to lucide components by the chip, not here. */
export type IconName =
  | 'timer'
  | 'stopwatch'
  | 'clock'
  | 'list'
  | 'bell'
  | 'calendar'
  | 'note'
  | 'calculator'
  | 'ruler';

export type IntentEntry<D = unknown> = {
  key: CardIntent;
  kind: WidgetKind;
  label: string;
  icon: IconName;
  parse: (text: string, ref: Date) => D;
  complete: (d: D) => boolean;
  summary: (d: D) => string;
  /** Only called when complete(d) is true. */
  toPayload: (d: D) => Record<string, unknown>;
};

const strip = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;

const timer: IntentEntry<TimerData> = {
  key: 'timer',
  kind: 'time',
  label: 'Timer',
  icon: 'timer',
  parse: (t) => parseTimer(t),
  complete: (d) => d.pomodoro || d.seconds != null,
  summary: (d) =>
    d.pomodoro
      ? `Pomodoro 25/5${d.label ? ` · ${d.label}` : ''}`
      : `Timer ${formatDuration(d.seconds ?? 0)}${d.label ? ` · ${d.label}` : ''}`,
  toPayload: (d) =>
    d.pomodoro
      ? strip({ mode: 'pomodoro', pomodoro: { workSec: 1500, breakSec: 300 }, label: d.label })
      : strip({ mode: 'timer', durationSec: d.seconds ?? 0, label: d.label }),
};

const stopwatch: IntentEntry<StopwatchData> = {
  key: 'stopwatch',
  kind: 'time',
  label: 'Stopwatch',
  icon: 'stopwatch',
  parse: (t) => parseStopwatch(t),
  complete: () => true,
  summary: (d) => `Stopwatch${d.label ? ` · ${d.label}` : ''}`,
  toPayload: (d) => strip({ mode: 'stopwatch', label: d.label }),
};

const clock: IntentEntry<ClockData> = {
  key: 'clock',
  kind: 'time',
  label: 'Clock',
  icon: 'clock',
  parse: (t) => parseClock(t),
  complete: () => true,
  summary: (d) => `Clock${d.place ? ` · ${d.place}` : ' · Local'}`,
  toPayload: (d) =>
    strip({ mode: 'clock', tz: d.tz ?? undefined, format: d.format ?? undefined, label: d.place ?? undefined }),
};

const todo: IntentEntry<TodoData> = {
  key: 'todo',
  kind: 'tasks',
  label: 'Checklist',
  icon: 'list',
  parse: (t) => parseTodo(t),
  complete: (d) => d.items.length >= 2 || (d.explicit && d.items.length >= 1),
  summary: (d) => `${d.title} · ${d.items.length} item${d.items.length === 1 ? '' : 's'}`,
  toPayload: (d) => ({ title: d.title, items: d.items.map((text) => ({ text })) }),
};

const reminder: IntentEntry<ReminderData> = {
  key: 'reminder',
  kind: 'tasks',
  label: 'Reminder',
  icon: 'bell',
  parse: (t, ref) => parseReminder(t, ref),
  complete: (d) => d.task.length > 0,
  summary: (d) => `Reminder · ${d.task}${d.due ? ` · ${d.due}${d.time ? ` ${d.time}` : ''}` : ''}`,
  toPayload: (d) => ({
    title: 'Reminder',
    items: [strip({ text: d.task, due: d.due ? (d.time ? `${d.due} ${d.time}` : d.due) : undefined })],
  }),
};

const event: IntentEntry<EventData> = {
  key: 'event',
  kind: 'key-value-card',
  label: 'Event',
  icon: 'calendar',
  parse: (t, ref) => parseEvent(t, ref),
  complete: (d) => d.date != null,
  summary: (d) => `Event · ${d.title}${d.when ? ` · ${d.when}` : ''}`,
  toPayload: (d) => {
    const fields: { key: string; value: string }[] = [];
    if (d.when) fields.push({ key: 'When', value: d.when });
    if (d.attendees.length) fields.push({ key: 'With', value: d.attendees.join(', ') });
    if (d.mode) fields.push({ key: 'Mode', value: titleCase(d.mode) });
    if (d.place) fields.push({ key: 'Where', value: d.place });
    const title = d.attendees.length ? `${d.title} with ${d.attendees.join(', ')}` : d.title;
    return { title, fields };
  },
};

const note: IntentEntry<NoteData> = {
  key: 'note',
  kind: 'sticky-note',
  label: 'Note',
  icon: 'note',
  parse: (t) => parseNote(t),
  complete: (d) => d.explicit && d.body.length > 0,
  summary: (d) => `Note · ${d.body.length > 40 ? `${d.body.slice(0, 40)}…` : d.body}`,
  toPayload: (d) => ({ body: d.body }),
};

const calc: IntentEntry<CalcData> = {
  key: 'calc',
  kind: 'key-value-card',
  label: 'Calc',
  icon: 'calculator',
  parse: (t) => parseCalc(t),
  complete: (d) => d.result != null,
  summary: (d) =>
    d.each != null
      ? `${d.expression} = ${formatNumber(d.each)} each`
      : `${d.expression} = ${formatNumber(d.result ?? 0)}`,
  toPayload: (d) => ({
    title: d.expression,
    fields: [
      { key: 'Result', value: formatNumber(d.result ?? 0) },
      ...(d.each != null ? [{ key: 'Each', value: formatNumber(d.each) }] : []),
    ],
  }),
};

const convert: IntentEntry<ConvertData | null> = {
  key: 'convert',
  kind: 'key-value-card',
  label: 'Convert',
  icon: 'ruler',
  parse: (t) => parseConvert(t),
  complete: (d) => d != null && d.result != null,
  summary: (d) => (d ? `${d.expression} = ${formatNumber(d.result ?? 0)} ${unitLabel(d.to)}` : 'Convert'),
  toPayload: (d) => ({
    title: d!.expression,
    fields: [{ key: 'Result', value: `${formatNumber(d!.result ?? 0)} ${unitLabel(d!.to)}` }],
  }),
};

export const INTENTS: Record<CardIntent, IntentEntry<any>> = {
  timer,
  stopwatch,
  clock,
  todo,
  reminder,
  event,
  note,
  calc,
  convert,
};

export type Resolved = {
  entry: IntentEntry<any>;
  data: unknown;
  complete: boolean;
  summary: string;
  payload: Record<string, unknown> | null;
};

export function resolve(intent: CardIntent, text: string, ref: Date): Resolved {
  const entry = INTENTS[intent];
  const data = entry.parse(text.trim(), ref);
  const complete = entry.complete(data);
  return {
    entry,
    data,
    complete,
    summary: entry.summary(data),
    payload: complete ? entry.toPayload(data) : null,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/intent/registry.test.ts`
Expected: PASS. The schema test imports `src/agent/payloads.ts` into the jsdom suite; it only depends on zod, which is fine.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: clean. If `IntentEntry<any>` trips a lint rule, the repo has no eslint gate in CI; keep `any` here, it is the one place the registry erases parser types on purpose.

- [ ] **Step 6: Commit**

```bash
git add app/src/intent/registry.ts __tests__/app/intent/registry.test.ts
git commit -m "feat(intent): registry maps intents to kinds, summaries, payloads

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Setting, demo flag on /v1/health, Settings toggle

**Files:**
- Modify: `app/src/state/user-settings-store.ts` (add `fastLane`)
- Modify: `src/backend/server.ts:96-110` (add `demo`)
- Modify: `app/src/api/health.ts` (type)
- Modify: `app/src/components/SettingsModal.tsx` (checkbox after the API key field, ~line 330)
- Test: `__tests__/app/user-settings-fastlane.test.ts`, `__tests__/backend.test.ts:32-40`

**Interfaces:**
- Produces: `UserSettings.fastLane: boolean | null`; `resolveFastLaneEnabled(setting, demo): boolean` exported from `user-settings-store.ts`; `HealthResponse.demo?: boolean`.

- [ ] **Step 1: Write the failing tests**

`__tests__/app/user-settings-fastlane.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useUserSettings,
  resolveFastLaneEnabled,
} from '../../app/src/state/user-settings-store';

beforeEach(() => useUserSettings.getState().reset());

describe('fast lane setting', () => {
  it('defaults to null (auto)', () => {
    expect(useUserSettings.getState().fastLane).toBeNull();
  });
  it('auto = on locally, off in demo', () => {
    expect(resolveFastLaneEnabled(null, false)).toBe(true);
    expect(resolveFastLaneEnabled(null, true)).toBe(false);
  });
  it('an explicit choice wins over demo', () => {
    expect(resolveFastLaneEnabled(true, true)).toBe(true);
    expect(resolveFastLaneEnabled(false, false)).toBe(false);
  });
  it('update persists the flag and reset clears it', () => {
    useUserSettings.getState().update({ fastLane: false });
    expect(useUserSettings.getState().fastLane).toBe(false);
    useUserSettings.getState().reset();
    expect(useUserSettings.getState().fastLane).toBeNull();
  });
});
```

Add to `__tests__/backend.test.ts` inside `describe('GET /v1/health')`:

```ts
  it('reports whether demo mode is on', async () => {
    const res = await app.request('/v1/health');
    const json = (await res.json()) as { demo: boolean };
    expect(typeof json.demo).toBe('boolean');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/user-settings-fastlane.test.ts && pnpm test -- __tests__/backend.test.ts`
Expected: app test FAIL (`resolveFastLaneEnabled` not exported); backend test FAIL (`demo` undefined).

- [ ] **Step 3: Store change**

In `app/src/state/user-settings-store.ts`:

```ts
export interface UserSettings {
  provider: UserProvider | null;
  model: string;
  apiKey: string;
  /**
   * Fast lane (instant local widgets for timers, lists, reminders…).
   * null = auto: on for local builds, off when the backend reports demo
   * mode. true/false = the user's explicit choice.
   */
  fastLane: boolean | null;
}

const EMPTY: UserSettings = { provider: null, model: '', apiKey: '', fastLane: null };

/** Resolve the tri-state setting against the backend's demo flag. */
export function resolveFastLaneEnabled(
  setting: boolean | null | undefined,
  demo: boolean,
): boolean {
  if (setting === true || setting === false) return setting;
  return !demo;
}
```

and in `partialize` add `fastLane: state.fastLane,`.

- [ ] **Step 4: Backend + type**

In `src/backend/server.ts` health handler, add `demo: isDemoMode(),` after `embedder`. In `app/src/api/health.ts` add to `HealthResponse`:

```ts
  /** True when the backend runs with OPENCANVAS_DEMO=1. Optional for older backends. */
  demo?: boolean;
```

- [ ] **Step 5: Settings checkbox**

In `app/src/components/SettingsModal.tsx`, after the API key `<div style={{ marginBottom: 18 }}>…</div>` block, add:

```tsx
            {/* Fast lane toggle */}
            <div style={{ marginBottom: 18 }}>
              <label
                htmlFor="settings-fast-lane"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  color: '#e4e4e7',
                  cursor: 'pointer',
                }}
              >
                <input
                  id="settings-fast-lane"
                  type="checkbox"
                  checked={resolveFastLaneEnabled(stored.fastLane, isDemo)}
                  onChange={(e) => update({ fastLane: e.target.checked })}
                />
                <span>Instant widgets for timers, lists and reminders (no model call)</span>
              </label>
            </div>
```

with, near the other hooks at the top of the component:

```tsx
  const isDemo = useAppStore(
    (s) => s.health.status === 'ok' && s.health.data.demo === true,
  );
```

and imports `resolveFastLaneEnabled` from `../state/user-settings-store` and `useAppStore` from `../state/app-store` (check the export name with `grep -n "export const use" app/src/state/app-store.ts`; use exactly what it exports).

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/user-settings-fastlane.test.ts __tests__/app/health.test.tsx && pnpm test -- __tests__/backend.test.ts && pnpm typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/state/user-settings-store.ts src/backend/server.ts app/src/api/health.ts app/src/components/SettingsModal.tsx __tests__/app/user-settings-fastlane.test.ts __tests__/backend.test.ts
git commit -m "feat(settings): fast-lane toggle (auto: on locally, off in demo) + health.demo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: `useFastLane` hook

**Files:**
- Create: `app/src/hooks/useFastLane.ts`
- Test: `__tests__/app/use-fast-lane.test.tsx`

**Interfaces:**
- Consumes: `classify`, `isEscaped` (Task 5); `decide`, `force`, `promote`, `initialMemory`, `activeIntent`, `changedSubstantially`, `UiState` (Task 1); `resolve`, `IconName` (Task 6).
- Produces: `useFastLane(text, opts): FastLaneView` and `FastLaneView`, `FAST_LANE_DEBOUNCE_MS = 120`.

- [ ] **Step 1: Write the failing tests**

`__tests__/app/use-fast-lane.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFastLane, FAST_LANE_DEBOUNCE_MS } from '../../app/src/hooks/useFastLane';

const REF = () => new Date('2026-09-26T09:00:00');

function setup(initial: string, enabled = true) {
  return renderHook(({ text, on }) => useFastLane(text, { enabled: on, ref: REF }), {
    initialProps: { text: initial, on: enabled },
  });
}

afterEach(() => vi.useRealTimers());

describe('useFastLane', () => {
  it('starts in input and commits after the debounce', () => {
    vi.useFakeTimers();
    const { result } = setup('25 min timer');
    expect(result.current.ui.kind).toBe('input');
    act(() => vi.advanceTimersByTime(FAST_LANE_DEBOUNCE_MS + 1));
    expect(result.current.ui.kind).toBe('committed');
    expect(result.current.resolved?.kind).toBe('time');
    expect(result.current.resolved?.summary).toBe('Timer 25:00');
    expect(result.current.resolved?.payload).toEqual({ mode: 'timer', durationSec: 1500 });
  });

  it('disabled → always input, no timers scheduled', () => {
    vi.useFakeTimers();
    const { result } = setup('25 min timer', false);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.ui.kind).toBe('input');
    expect(result.current.resolved).toBeNull();
  });

  it('escaped text is never classified', () => {
    vi.useFakeTimers();
    const { result } = setup('/clear');
    act(() => vi.advanceTimersByTime(500));
    expect(result.current.ui.kind).toBe('input');
  });

  it('dismiss holds until the text changes substantially', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup('25 min timer');
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('committed');
    act(() => result.current.dismiss());
    expect(result.current.ui.kind).toBe('input');
    rerender({ text: '25 min timers', on: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('input');
    rerender({ text: 'buy milk, eggs, bread', on: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('committed');
    expect(result.current.resolved?.kind).toBe('tasks');
  });

  it('promote turns a ghost into committed', () => {
    vi.useFakeTimers();
    const { result } = setup('25 min'); // duration only: ghost
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui.kind).toBe('ghost');
    act(() => result.current.promote());
    expect(result.current.ui.kind).toBe('committed');
  });

  it('choose forces an option', () => {
    vi.useFakeTimers();
    const { result, rerender } = setup('25 min timer');
    act(() => vi.advanceTimersByTime(200));
    // Force the choose state through the public API: pick(1) on a non-choose is a no-op…
    act(() => result.current.choose(0));
    expect(result.current.ui.kind).toBe('committed');
    // …and forcing an intent locks it against small edits.
    rerender({ text: '25 min timer!', on: true });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.ui).toMatchObject({ kind: 'committed', intent: 'timer' });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/use-fast-lane.test.tsx`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Write the hook**

`app/src/hooks/useFastLane.ts`:

```ts
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
  type DecideMemory,
  type UiState,
} from '../intent/decide';
import { resolve, type IconName } from '../intent/registry';
import type { CardIntent } from '../intent/types';

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
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || isEscaped(text)) {
      setMem(initialMemory);
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
      setMem((m) => decide(m, result, text));
    }, FAST_LANE_DEBOUNCE_MS);
    return () => clearTimeout(id);
    // `ref` is a stable getter by contract; excluding it avoids re-arming on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, enabled, dismissedFor]);

  const resolved = useMemo<FastLaneResolved | null>(() => {
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
  }, [mem.ui, text, enabled]);

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

  return { ui: mem.ui, resolved, options, promote, choose, dismiss };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/use-fast-lane.test.tsx`
Expected: PASS. If the `'25 min'` ghost test commits instead, the classifier gives a bare duration too much weight; the fixture in Task 5 does not pin `'25 min'`, so adjust `keywords.ts` (`timer.seconds != null` bonus 4 → 3) and re-run both Task 5 and this test.

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useFastLane.ts __tests__/app/use-fast-lane.test.tsx
git commit -m "feat(intent): useFastLane hook (debounce, hysteresis, promote/choose/dismiss)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `FastLaneChip` and the composer status row

**Files:**
- Create: `app/src/components/FastLaneChip.tsx`
- Modify: `app/src/components/ComposerStatus.tsx` (add `leading` prop; render row when either exists)
- Modify: `app/src/styles/globals.css` (append after `.opencanvas-composer-hits-chip` rules, ~line 2300)
- Test: `__tests__/app/FastLaneChip.test.tsx`

**Interfaces:**
- Consumes: `FastLaneView` (Task 8), `IconName` (Task 6).
- Produces: `<FastLaneChip view={FastLaneView} />`; `ComposerStatus` accepts `leading?: React.ReactNode`.

- [ ] **Step 1: Write the failing tests**

`__tests__/app/FastLaneChip.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FastLaneChip } from '../../app/src/components/FastLaneChip';
import type { FastLaneView } from '../../app/src/hooks/useFastLane';

const base = (over: Partial<FastLaneView>): FastLaneView => ({
  ui: { kind: 'input' },
  resolved: null,
  options: null,
  promote: vi.fn(),
  choose: vi.fn(),
  dismiss: vi.fn(),
  ...over,
});

const resolved = {
  intent: 'timer' as const,
  kind: 'time' as const,
  label: 'Timer',
  icon: 'timer' as const,
  summary: 'Timer 25:00 · Focus',
  payload: { mode: 'timer', durationSec: 1500 },
};

describe('FastLaneChip', () => {
  it('renders nothing for input', () => {
    const { container } = render(<FastLaneChip view={base({})} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('ghost shows the summary and the Tab hint', () => {
    render(<FastLaneChip view={base({ ui: { kind: 'ghost', intent: 'timer' }, resolved })} />);
    expect(screen.getByText('Timer 25:00 · Focus')).toBeInTheDocument();
    expect(screen.getByText(/place instantly/i)).toBeInTheDocument();
  });
  it('committed shows Enter / Mod+Enter hints and a dismiss button', () => {
    const view = base({ ui: { kind: 'committed', intent: 'timer' }, resolved });
    render(<FastLaneChip view={view} />);
    expect(screen.getByText(/ask model/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/dismiss instant widget/i));
    expect(view.dismiss).toHaveBeenCalledTimes(1);
  });
  it('choose renders two options and forwards the pick', () => {
    const view = base({
      ui: { kind: 'choose', options: ['event', 'reminder'] },
      options: [
        { intent: 'event', label: 'Event' },
        { intent: 'reminder', label: 'Reminder' },
      ],
    });
    render(<FastLaneChip view={view} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reminder' }));
    expect(view.choose).toHaveBeenCalledWith(1);
  });
  it('incomplete committed data says what is missing', () => {
    render(
      <FastLaneChip
        view={base({ ui: { kind: 'committed', intent: 'timer' }, resolved: { ...resolved, payload: null } })}
      />,
    );
    expect(screen.getByText(/add a duration/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/FastLaneChip.test.tsx`
Expected: FAIL, unresolved import.

- [ ] **Step 3: Write the chip**

`app/src/components/FastLaneChip.tsx`:

```tsx
import {
  Bell,
  CalendarDays,
  Calculator,
  Clock,
  ListChecks,
  Ruler,
  StickyNote,
  Timer,
  Watch,
  X,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { FastLaneView } from '../hooks/useFastLane';
import type { IconName } from '../intent/registry';
import type { CardIntent } from '../intent/types';

const ICONS: Record<IconName, ComponentType<{ className?: string }>> = {
  timer: Timer,
  stopwatch: Watch,
  clock: Clock,
  list: ListChecks,
  bell: Bell,
  calendar: CalendarDays,
  note: StickyNote,
  calculator: Calculator,
  ruler: Ruler,
};

/** What a committed-but-incomplete parse still needs. */
const MISSING: Record<CardIntent, string> = {
  timer: 'add a duration',
  stopwatch: '',
  clock: '',
  todo: 'add a second item',
  reminder: 'add what to remember',
  event: 'add a day or time',
  note: 'add the note text',
  calc: 'finish the expression',
  convert: 'name both units',
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

/**
 * Live preview of what the fast lane will place. Presentational: every
 * action goes back through the FastLaneView callbacks.
 */
export function FastLaneChip({ view }: { view: FastLaneView }) {
  const { ui, resolved, options } = view;

  if (ui.kind === 'choose' && options) {
    return (
      <div className="opencanvas-fastlane-chip is-choose" role="group" aria-label="Did you mean">
        <span className="opencanvas-fastlane-muted">Did you mean</span>
        {options.map((o, i) => (
          <button
            key={o.intent}
            type="button"
            className="opencanvas-fastlane-option"
            onClick={() => view.choose(i as 0 | 1)}
          >
            {o.label}
          </button>
        ))}
        <span className="opencanvas-fastlane-muted"><kbd>←</kbd><kbd>→</kbd></span>
      </div>
    );
  }

  if ((ui.kind !== 'ghost' && ui.kind !== 'committed') || !resolved) return null;

  const Icon = ICONS[resolved.icon];
  const ghost = ui.kind === 'ghost';
  const incomplete = resolved.payload === null;

  return (
    <div
      className={`opencanvas-fastlane-chip ${ghost ? 'is-ghost' : 'is-committed'}`}
      role="status"
      aria-live="polite"
    >
      <Icon className="size-3" />
      <span className="opencanvas-fastlane-summary">{resolved.summary}</span>
      {incomplete ? (
        <span className="opencanvas-fastlane-muted">{MISSING[resolved.intent] || 'incomplete'}</span>
      ) : ghost ? (
        <span className="opencanvas-fastlane-muted"><kbd>⇥</kbd> place instantly</span>
      ) : (
        <span className="opencanvas-fastlane-muted">
          <kbd>↵</kbd> place · <kbd>{MOD}↵</kbd> ask model
        </span>
      )}
      <button
        type="button"
        className="opencanvas-fastlane-dismiss"
        onClick={view.dismiss}
        aria-label="Dismiss instant widget"
        title="Dismiss (Esc)"
      >
        <X className="size-3" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Extend `ComposerStatus`**

In `app/src/components/ComposerStatus.tsx`, add `leading?: React.ReactNode` to the props type and destructure it; change the early return and the row:

```tsx
  if (!showHitsChip && !leading) return null;

  return (
    <div className="opencanvas-composer-status-row">
      {leading}
      {showHitsChip && (
```

Add `import type { ReactNode } from 'react';` and type the prop as `leading?: ReactNode`.

- [ ] **Step 5: CSS**

Append to `app/src/styles/globals.css` directly after the `.opencanvas-composer-hits-chip` block:

```css
/* Fast lane chip — live preview of the widget Enter will place. */
.opencanvas-fastlane-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: #e4e4e7;
  background: rgba(45, 212, 191, 0.10);
  border: 1px solid rgba(45, 212, 191, 0.35);
  transition: opacity 140ms ease, border-color 140ms ease;
}
.opencanvas-fastlane-chip.is-ghost {
  opacity: 0.6;
  border-style: dashed;
}
.opencanvas-fastlane-chip.is-choose {
  background: rgba(167, 139, 250, 0.10);
  border-color: rgba(167, 139, 250, 0.32);
}
.opencanvas-fastlane-summary {
  font-weight: 600;
  color: #5eead4;
}
.opencanvas-fastlane-muted {
  color: #a1a1aa;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.opencanvas-fastlane-chip kbd {
  font: 600 10px/1 ui-monospace, monospace;
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
}
.opencanvas-fastlane-option {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 12px;
  color: #c4b5fd;
  background: rgba(167, 139, 250, 0.14);
  border: 1px solid rgba(167, 139, 250, 0.4);
  cursor: pointer;
}
.opencanvas-fastlane-dismiss {
  display: inline-flex;
  padding: 2px;
  border-radius: 999px;
  color: #a1a1aa;
  background: transparent;
  border: none;
  cursor: pointer;
}
.opencanvas-fastlane-dismiss:hover {
  color: #fafafa;
  background: rgba(255, 255, 255, 0.08);
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/FastLaneChip.test.tsx && pnpm typecheck`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/components/FastLaneChip.tsx app/src/components/ComposerStatus.tsx app/src/styles/globals.css __tests__/app/FastLaneChip.test.tsx
git commit -m "feat(composer): FastLaneChip + leading slot in ComposerStatus

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Wire the fast lane into `Chat.tsx`

**Files:**
- Create: `app/src/components/FastLaneNote.tsx`
- Modify: `app/src/components/Chat.tsx` (imports ~1-40; `useChat` transport ~356-392; `indexConversation` call ~639; `handleSubmit` ~542-560; message render ~669-693; `<ComposerStatus` ~914; textarea `onKeyDown` ~967)
- Test: `__tests__/app/fast-lane-chat.test.tsx`

**Interfaces:**
- Consumes: `useFastLane`, `FastLaneChip`, `resolveFastLaneEnabled`, `validatePayloadForKind`, `applyToolDirective`, `getEditor`, `useTemplateStore`, `usePreferences`.
- Produces: local assistant messages with `metadata: { local: 'fast-lane', originalText }`; `isLocalNote(m)` helper exported from `FastLaneNote.tsx`.

- [ ] **Step 1: Write the failing integration test**

`__tests__/app/fast-lane-chat.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const sendMessage = vi.fn();
const setMessages = vi.fn();
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    setMessages,
    status: 'ready',
    stop: vi.fn(),
    error: undefined,
  }),
}));

const applyToolDirective = vi.fn();
vi.mock('../../app/src/canvas/dispatcher', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../app/src/canvas/dispatcher')>();
  return { ...mod, applyToolDirective };
});

const fakeEditor = { getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) };
vi.mock('../../app/src/state/editor-ref', () => ({
  getEditor: () => fakeEditor,
  setEditor: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { Chat } from '../../app/src/components/Chat';
import { useUserSettings } from '../../app/src/state/user-settings-store';

beforeEach(() => {
  sendMessage.mockReset();
  setMessages.mockReset();
  applyToolDirective.mockReset();
  useUserSettings.getState().reset();
  // kbSearch() fires a fetch on send; keep jsdom quiet.
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: false, json: async () => ({}) } as Response),
  ) as unknown as typeof fetch;
});

async function typeAndWaitForChip(text: string) {
  const input = screen.getByPlaceholderText(/ask opencanvas anything/i) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: text } });
  await screen.findByText(/ask model/i, {}, { timeout: 1500 });
  return input;
}

describe('fast lane in Chat', () => {
  it('Enter on a committed chip places locally and does not call the model', async () => {
    render(<Chat />);
    const input = await typeAndWaitForChip('25 min timer');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(applyToolDirective).toHaveBeenCalledTimes(1));
    const directive = applyToolDirective.mock.calls[0][1];
    expect(directive).toMatchObject({
      type: 'place',
      kind: 'time',
      role: 'primary',
      payload: { mode: 'timer', durationSec: 1500 },
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(setMessages).toHaveBeenCalledTimes(1);
    const updater = setMessages.mock.calls[0][0] as (prev: unknown[]) => unknown[];
    const next = updater([]);
    expect(next[0]).toMatchObject({
      role: 'assistant',
      metadata: { local: 'fast-lane', originalText: '25 min timer' },
    });
    expect(input.value).toBe('');
  });

  it('Mod+Enter bypasses the fast lane and asks the model', async () => {
    render(<Chat />);
    const input = await typeAndWaitForChip('25 min timer');
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ text: '25 min timer' }));
    expect(applyToolDirective).not.toHaveBeenCalled();
  });

  it('with the setting off, Enter goes to the model', async () => {
    useUserSettings.getState().update({ fastLane: false });
    render(<Chat />);
    const input = screen.getByPlaceholderText(/ask opencanvas anything/i);
    fireEvent.change(input, { target: { value: '25 min timer' } });
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByText(/ask model/i)).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(applyToolDirective).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/fast-lane-chat.test.tsx`
Expected: FAIL: the chip never appears (`findByText` times out).

- [ ] **Step 3: Write `FastLaneNote.tsx`**

`app/src/components/FastLaneNote.tsx`:

```tsx
import { Sparkles } from 'lucide-react';

export type LocalNoteMeta = { local: 'fast-lane'; originalText: string };

/** True for the transcript line a fast-lane placement leaves behind. */
export function isLocalNote(m: { metadata?: unknown }): m is { metadata: LocalNoteMeta } {
  const meta = m.metadata as Partial<LocalNoteMeta> | undefined;
  return meta?.local === 'fast-lane' && typeof meta.originalText === 'string';
}

/** Messages that must never be sent to the model or indexed. */
export function notLocalNote<T extends { metadata?: unknown }>(m: T): boolean {
  return !isLocalNote(m);
}

export function FastLaneNote({ text, onAsk }: { text: string; onAsk: (text: string) => void }) {
  return (
    <div className="opencanvas-fastlane-note">
      <button type="button" onClick={() => onAsk(text)} className="opencanvas-fastlane-note-ask">
        <Sparkles className="size-3" /> Ask the model instead
      </button>
    </div>
  );
}
```

Append to `globals.css` after the fast-lane chip rules:

```css
.opencanvas-fastlane-note { margin-top: 2px; }
.opencanvas-fastlane-note-ask {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; color: #c4b5fd; background: transparent; border: none;
  padding: 0; cursor: pointer;
}
.opencanvas-fastlane-note-ask:hover { color: #e9d5ff; text-decoration: underline; }
```

- [ ] **Step 4: Imports and hook in `Chat.tsx`**

Add imports after line 36 (`usePreferences`):

```ts
import { useFastLane } from '../hooks/useFastLane';
import { FastLaneChip } from './FastLaneChip';
import { FastLaneNote, isLocalNote, notLocalNote } from './FastLaneNote';
import { resolveFastLaneEnabled, useUserSettings } from '../state/user-settings-store';
import { useAppStore } from '../state/app-store';
import { validatePayloadForKind } from '../../../src/agent/payloads';
```

(If `getUserSettingsHeaders` is already imported from the same module on line 25, merge into one import statement. If `app-store.ts` exports a different hook name, use that.)

After `const [input, setInput] = useState('');` (line ~393) and after `isStreaming` is defined, add:

```ts
  const fastLaneSetting = useUserSettings((s) => s.fastLane);
  const isDemo = useAppStore(
    (s) => s.health.status === 'ok' && s.health.data.demo === true,
  );
  const fastLane = useFastLane(input, {
    enabled: resolveFastLaneEnabled(fastLaneSetting, isDemo) && !isStreaming,
  });
```

- [ ] **Step 5: Keep local notes out of the model and the index**

In `prepareSendMessagesRequest` change `body: { ...body, messages: msgs },` to:

```ts
          body: { ...body, messages: msgs.filter(notLocalNote) },
```

At line ~639 change `void indexConversation(activeId, messages);` to:

```ts
    void indexConversation(activeId, messages.filter(notLocalNote));
```

- [ ] **Step 6: Placement on submit**

Replace `handleSubmit` with:

```ts
  /**
   * Fast lane: place the previewed widget locally. Returns false whenever
   * anything is off (not committed, incomplete parse, no editor, payload
   * rejected by the schema) so the caller falls through to the model path.
   */
  const placeFastLane = (): boolean => {
    const r = fastLane.resolved;
    if (!r || !r.payload || fastLane.ui.kind !== 'committed') return false;
    const editor = getEditor();
    if (!editor) return false;
    let payload: Record<string, unknown>;
    try {
      payload = validatePayloadForKind(r.kind, r.payload);
    } catch (e) {
      logger.warn('[fast-lane] payload rejected, falling back to model:', e);
      return false;
    }
    const id = crypto.randomUUID();
    try {
      applyToolDirective(
        editor,
        { type: 'place', id, kind: r.kind, role: 'primary', payload },
        useTemplateStore.getState().activeTemplateId,
      );
    } catch (e) {
      logger.error('[fast-lane] place failed:', e);
      return false;
    }
    usePreferences.getState().record(activeId, r.kind, 'placed');
    const originalText = input;
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: 'assistant' as const,
        parts: [{ type: 'text' as const, text: `Placed ${r.summary} without the model.` }],
        metadata: { local: 'fast-lane', originalText },
      },
    ]);
    return true;
  };

  const submit = (forceModel: boolean) => {
    if (!input.trim() || isStreaming) return;
    if (tryRunCommand(input)) {
      setInput('');
      return;
    }
    if (!forceModel && placeFastLane()) {
      setInput('');
      return;
    }
    kbSearch(input);
    sendMessage({ text: input });
    setInput('');
    useAnonUsage.getState().bumpMessages();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit(false);
  };
```

- [ ] **Step 7: Keys**

In the textarea `onKeyDown`, before the existing `Enter` branch, insert:

```ts
                  const isModKey = e.metaKey || e.ctrlKey;
                  if (e.key === 'Enter' && isModKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit(true);
                    return;
                  }
                  if (e.key === 'Tab' && fastLane.ui.kind === 'ghost') {
                    e.preventDefault();
                    fastLane.promote();
                    return;
                  }
                  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && fastLane.ui.kind === 'choose') {
                    e.preventDefault();
                    fastLane.choose(e.key === 'ArrowLeft' ? 0 : 1);
                    return;
                  }
                  if (e.key === 'Escape' && fastLane.ui.kind !== 'input') {
                    e.preventDefault();
                    fastLane.dismiss();
                    return;
                  }
```

Note the existing markdown-shortcut block later in the handler starts with `const isMod = e.metaKey || e.ctrlKey;`; Mod+Enter returns before it, so there is no conflict.

- [ ] **Step 8: Chip and note rendering**

Change `<ComposerStatus` to pass the chip:

```tsx
      <ComposerStatus
        leading={fastLane.ui.kind === 'input' ? null : <FastLaneChip view={fastLane} />}
        query={kbQuery}
```

In the message map, directly after the `opencanvas-chat-msg-header` `</div>`, add:

```tsx
              {isLocalNote(m) && (
                <FastLaneNote
                  text={m.metadata.originalText}
                  onAsk={(text) => {
                    kbSearch(text);
                    sendMessage({ text });
                  }}
                />
              )}
```

- [ ] **Step 9: Run the integration test, then both suites**

Run: `pnpm vitest run --config app/vite.config.ts __tests__/app/fast-lane-chat.test.tsx`
Expected: PASS (3 tests).

Run: `pnpm typecheck && pnpm test && pnpm vitest run --config app/vite.config.ts`
Expected: typecheck clean; backend 396+1 passed; app suite all passed (previous 214 plus the new files). If `Chat.smoke.test.tsx` fails on `useAppStore`, the smoke test renders `<Chat />` without mocking the store, which is fine: the default health state is `loading`, so `isDemo` is false.

- [ ] **Step 10: Manual check**

Run `pnpm dev`, open http://127.0.0.1:3458, type `25 min focus`. Expect a teal chip "Timer 25:00 · Focus ↵ place · ⌘↵ ask model" within ~150 ms; Enter places a timer widget and a one-line assistant note with "Ask the model instead" appears. Type `buy milk, eggs, bread` → checklist. Type `explain this code` → no chip.

- [ ] **Step 11: Commit**

```bash
git add app/src/components/Chat.tsx app/src/components/FastLaneNote.tsx app/src/styles/globals.css __tests__/app/fast-lane-chat.test.tsx
git commit -m "feat(chat): fast lane — Enter places recognised widgets locally, ⌘↵ asks the model

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Docs, changelog, final verification, push

**Files:**
- Modify: `README.md` (widget catalog section, one paragraph)
- Modify: `CHANGELOG.md` (`[Unreleased]` → Added)
- Modify: `docs/plans/fast-lane-intent.md` (status line)

- [ ] **Step 1: README**

In `README.md`, under "## The widget catalog", after the "Runtime plugins" paragraph, add:

```markdown
**Instant widgets.** Timers, stopwatches, clocks, checklists, reminders, events, notes, arithmetic and unit conversions are recognised as you type and placed on Enter with no model call, so they work offline and with no API key. A chip above the composer previews exactly what will be placed; ⌘↵ sends the same text to the model instead. Toggle it in Settings.
```

- [ ] **Step 2: CHANGELOG**

Under `## [Unreleased]` → `### Added`, prepend:

```markdown
- **Fast lane: instant local widgets** — a keyword classifier plus
  deterministic parsers (chrono-node for dates) recognise utility prompts
  (timer, stopwatch, clock, checklist, reminder, event, note, calc,
  convert) as you type. Enter places the widget through the dispatcher
  with no model call; ⌘/Ctrl+Enter asks the model instead. Calm-UI
  hysteresis ported from anishfn/shapeshift (MIT). Off by default in
  demo mode for the first deploy (`/v1/health` now reports `demo`).
  Setting: "Instant widgets" in Settings. Design:
  `docs/plans/fast-lane-intent.md`.
```

- [ ] **Step 3: Spec status**

Change the spec's status line to `*Design spec. Status: implemented 2026-XX-XX (fill the date).*`

- [ ] **Step 4: Full verification**

```bash
pnpm typecheck
pnpm test
pnpm vitest run --config app/vite.config.ts
pnpm audit --prod --audit-level=moderate
pnpm app:build 2>&1 | tail -3
```

Expected: all green; the build lists a `vendor-chrono` chunk and no warnings about circular chunks.

- [ ] **Step 5: Commit and push**

```bash
git add README.md CHANGELOG.md docs/plans/fast-lane-intent.md
git commit -m "docs: fast lane in README + changelog

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push https://oauth2:$(gh auth token)@github.com/ashark-ai-05/opencanvas.git main
```

- [ ] **Step 6: Watch CI**

```bash
gh run watch $(gh run list --workflow ci --branch main --limit 1 --json databaseId -q '.[0].databaseId') --exit-status
```

Expected: success. Do **not** run `railway up` as part of this plan; the demo deploy is a separate decision (spec §8 says the first deploy ships with the fast lane off in demo mode, which this plan already guarantees through `health.demo`).

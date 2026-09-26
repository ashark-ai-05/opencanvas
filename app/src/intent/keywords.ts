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

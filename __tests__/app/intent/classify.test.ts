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

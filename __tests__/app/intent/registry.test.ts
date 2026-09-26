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

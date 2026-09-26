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

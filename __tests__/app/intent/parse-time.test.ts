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

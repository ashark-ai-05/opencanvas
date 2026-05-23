import { describe, it, expect } from 'vitest';
import {
  TimePayload,
  validatePayloadForKind,
} from '../../src/agent/payloads.js';

describe('TimePayload', () => {
  it('accepts a minimal clock', () => {
    expect(TimePayload.safeParse({ mode: 'clock' }).success).toBe(true);
  });

  it('accepts a clock with tz + format + label', () => {
    expect(
      TimePayload.safeParse({
        mode: 'clock',
        tz: 'Asia/Tokyo',
        format: '24h',
        label: 'Tokyo',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown mode', () => {
    expect(
      TimePayload.safeParse({ mode: 'sundial' }).success,
    ).toBe(false);
  });

  it('accepts a running timer', () => {
    const r = TimePayload.safeParse({
      mode: 'timer',
      durationSec: 1500,
      startedAt: Date.now(),
    });
    expect(r.success).toBe(true);
  });

  it('rejects negative durationSec', () => {
    expect(
      TimePayload.safeParse({
        mode: 'timer',
        durationSec: -5,
      }).success,
    ).toBe(false);
  });

  it('accepts a paused stopwatch with elapsed bank', () => {
    expect(
      TimePayload.safeParse({
        mode: 'stopwatch',
        elapsedAtPause: 42.5,
        paused: true,
      }).success,
    ).toBe(true);
  });

  it('accepts a full pomodoro config', () => {
    const r = TimePayload.safeParse({
      mode: 'pomodoro',
      startedAt: Date.now(),
      pomodoro: {
        workSec: 1500,
        breakSec: 300,
        longBreakSec: 900,
        longBreakEvery: 4,
        sessions: 0,
        phase: 'work',
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects pomodoro missing required fields', () => {
    const r = TimePayload.safeParse({
      mode: 'pomodoro',
      pomodoro: { workSec: 1500 }, // missing breakSec
    });
    expect(r.success).toBe(false);
  });

  it('routes through validatePayloadForKind for kind=time', () => {
    const out = validatePayloadForKind('time', { mode: 'clock', tz: 'UTC' });
    expect(out).toEqual({ mode: 'clock', tz: 'UTC' });
  });
});

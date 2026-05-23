import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeElapsedSec,
  formatHMS,
} from '../../app/src/canvas/shapes/time';

describe('time widget — pure helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatHMS', () => {
    it('zero pads minutes/seconds under one hour', () => {
      expect(formatHMS(0)).toBe('00:00');
      expect(formatHMS(5)).toBe('00:05');
      expect(formatHMS(65)).toBe('01:05');
      expect(formatHMS(1500)).toBe('25:00');
    });
    it('shows hours when total >= 3600s', () => {
      expect(formatHMS(3600)).toBe('1:00:00');
      expect(formatHMS(3661)).toBe('1:01:01');
    });
    it('floors fractional seconds', () => {
      expect(formatHMS(1.9)).toBe('00:01');
      expect(formatHMS(59.99)).toBe('00:59');
    });
    it('clamps negatives to 00:00', () => {
      expect(formatHMS(-50)).toBe('00:00');
    });
  });

  describe('computeElapsedSec', () => {
    it('returns 0 for an unstarted shape', () => {
      expect(computeElapsedSec({})).toBe(0);
    });
    it('returns elapsedAtPause when paused', () => {
      expect(
        computeElapsedSec({ paused: true, elapsedAtPause: 42, startedAt: 100 }),
      ).toBe(42);
    });
    it('treats undefined elapsedAtPause as 0 when paused', () => {
      expect(computeElapsedSec({ paused: true })).toBe(0);
    });
    it('adds (now - startedAt) when running', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-07T12:00:30Z')); // 30s past
      const startedAt = new Date('2026-05-07T12:00:00Z').getTime();
      expect(
        computeElapsedSec({ startedAt, elapsedAtPause: 10 }),
      ).toBe(40); // 10s prior + 30s current run
    });
    it('does not double-count: paused with startedAt set still freezes', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-07T12:00:30Z'));
      const startedAt = new Date('2026-05-07T12:00:00Z').getTime();
      expect(
        computeElapsedSec({
          startedAt,
          elapsedAtPause: 100,
          paused: true,
        }),
      ).toBe(100);
    });
    it('clamps negative startedAt drift to 0', () => {
      // startedAt in the future (clock skew, NTP step, etc.) — no negative.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-07T12:00:00Z'));
      const startedAt = new Date('2026-05-07T13:00:00Z').getTime();
      expect(computeElapsedSec({ startedAt, elapsedAtPause: 0 })).toBe(0);
    });
  });
});

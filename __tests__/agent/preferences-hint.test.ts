import { describe, it, expect } from 'vitest';
import { buildPreferencesHint } from '../../src/agent/preferences-hint.js';

describe('buildPreferencesHint', () => {
  it('returns empty string for undefined / null / empty input', () => {
    expect(buildPreferencesHint(undefined)).toBe('');
    expect(buildPreferencesHint(null)).toBe('');
    expect(buildPreferencesHint({ byKind: {} })).toBe('');
  });

  it('returns empty string when every kind nets to score 0', () => {
    const out = buildPreferencesHint({
      byKind: {
        markdown: { placed: 1, deleted: 1, pinned: 0 }, // score 0
      },
    });
    expect(out).toBe('');
  });

  it('lists positive-score kinds under "Preferred"', () => {
    const out = buildPreferencesHint({
      byKind: {
        chart: { placed: 4, deleted: 0, pinned: 2 }, // score 8
        markdown: { placed: 3, deleted: 0, pinned: 0 }, // score 3
      },
    });
    expect(out).toMatch(/Preferred:.*chart \(score 8\).*markdown \(score 3\)/);
  });

  it('lists negative-score kinds under "Often dismissed" with delete count', () => {
    const out = buildPreferencesHint({
      byKind: {
        ticket: { placed: 0, deleted: 4, pinned: 0 }, // score -4
        kanban: { placed: 1, deleted: 3, pinned: 0 }, // score -2
      },
    });
    expect(out).toMatch(/Often dismissed:.*ticket \(4 dismissals\).*kanban \(3 dismissals\)/);
  });

  it('caps both lists at 5 entries', () => {
    const byKind: Record<
      string,
      { placed: number; deleted: number; pinned: number }
    > = {};
    for (let i = 0; i < 8; i++) {
      byKind[`pref-${i}`] = { placed: 10 - i, deleted: 0, pinned: 0 };
      byKind[`avoid-${i}`] = { placed: 0, deleted: 10 - i, pinned: 0 };
    }
    const out = buildPreferencesHint({ byKind });
    expect((out.match(/pref-/g) ?? []).length).toBe(5);
    expect((out.match(/avoid-/g) ?? []).length).toBe(5);
  });

  it('orders preferred descending by score and avoided ascending (most-disliked first)', () => {
    const out = buildPreferencesHint({
      byKind: {
        a: { placed: 2, deleted: 0, pinned: 0 }, // 2
        b: { placed: 5, deleted: 0, pinned: 0 }, // 5
        c: { placed: 1, deleted: 0, pinned: 0 }, // 1
        d: { placed: 0, deleted: 1, pinned: 0 }, // -1
        e: { placed: 0, deleted: 5, pinned: 0 }, // -5
      },
    });
    const idxB = out.indexOf('b ');
    const idxA = out.indexOf('a ');
    const idxC = out.indexOf('c ');
    expect(idxB).toBeGreaterThan(0);
    expect(idxB).toBeLessThan(idxA);
    expect(idxA).toBeLessThan(idxC);
    const idxE = out.indexOf('e ');
    const idxD = out.indexOf('d ');
    expect(idxE).toBeLessThan(idxD);
  });

  it('weights pin counts double in the score', () => {
    const pinned = buildPreferencesHint({
      byKind: { x: { placed: 0, deleted: 0, pinned: 3 } }, // score 6
    });
    expect(pinned).toMatch(/x \(score 6\)/);
  });
});

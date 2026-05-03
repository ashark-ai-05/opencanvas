import { describe, it, expect } from 'vitest';
import {
  ASK_ANYTHING_TEMPLATE,
  TELL_ME_ABOUT_X_TEMPLATE,
  WHATS_NEW_SINCE_Y_TEMPLATE,
  TRACE_X_EVERYWHERE_TEMPLATE,
} from '../../app/src/canvas/templates';
import type { Box } from 'tldraw';

const viewport = { x: 0, y: 0, w: 1200, h: 800 } as unknown as Box;

describe('template.slotForRole', () => {
  it('every template implements slotForRole for all 6 roles', () => {
    const tpls = [
      ASK_ANYTHING_TEMPLATE,
      TELL_ME_ABOUT_X_TEMPLATE,
      WHATS_NEW_SINCE_Y_TEMPLATE,
      TRACE_X_EVERYWHERE_TEMPLATE,
    ];
    const roles = ['primary', 'detail', 'related', 'reference', 'timeline', 'node'] as const;
    for (const t of tpls) {
      for (const role of roles) {
        const slot = t.slotForRole(role, 0, viewport);
        expect(typeof slot.x).toBe('number');
        expect(typeof slot.y).toBe('number');
        expect(slot.w).toBeGreaterThan(0);
        expect(slot.h).toBeGreaterThan(0);
        expect(Number.isFinite(slot.x)).toBe(true);
        expect(Number.isFinite(slot.y)).toBe(true);
      }
    }
  });

  it('different occupancies of the same role produce different positions', () => {
    const tpls = [
      ASK_ANYTHING_TEMPLATE,
      TELL_ME_ABOUT_X_TEMPLATE,
      WHATS_NEW_SINCE_Y_TEMPLATE,
      TRACE_X_EVERYWHERE_TEMPLATE,
    ];
    for (const t of tpls) {
      const a = t.slotForRole('related', 0, viewport);
      const b = t.slotForRole('related', 1, viewport);
      expect(a.x !== b.x || a.y !== b.y).toBe(true);
    }
  });
});

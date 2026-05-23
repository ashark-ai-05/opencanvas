import { describe, it, expect } from 'vitest';
import { spring } from '../../app/src/lib/motion/springs';

describe('motion/springs', () => {
  it('exposes soft, firm, and snappy presets with calibrated physics', () => {
    expect(spring.soft).toEqual({ stiffness: 180, damping: 28, mass: 0.6 });
    expect(spring.firm).toEqual({ stiffness: 260, damping: 30, mass: 0.5 });
    expect(spring.snappy).toEqual({ stiffness: 380, damping: 30, mass: 0.4 });
  });

  it('preset keys are exhaustive', () => {
    expect(Object.keys(spring).sort()).toEqual(['firm', 'snappy', 'soft']);
  });
});

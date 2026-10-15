import { describe, expect, it } from 'vitest';
import html from '../../app/index.html?raw';
import { isNarrowWidth, NARROW_MAX_WIDTH, NARROW_QUERY } from '../../app/src/lib/narrow-viewport';

describe('narrow viewport', () => {
  it('treats phone widths as narrow and desktop as wide', () => {
    for (const w of [320, 375, 390, 430, 640]) expect(isNarrowWidth(w)).toBe(true);
    for (const w of [641, 768, 1280]) expect(isNarrowWidth(w)).toBe(false);
    expect(isNarrowWidth(0)).toBe(false);
    expect(isNarrowWidth(Number.NaN)).toBe(false);
  });

  it('exposes the query string the CSS uses', () => {
    expect(NARROW_QUERY).toBe(`(max-width: ${NARROW_MAX_WIDTH}px)`);
  });

  it('index.html is phone-ready (viewport-fit, theme-color)', () => {
    expect(html).toMatch(/viewport-fit=cover/);
    expect(html).toMatch(/name="theme-color"/);
  });
});

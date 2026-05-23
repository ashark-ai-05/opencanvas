import { describe, it, expect } from 'vitest';
import { splitText } from '../src/indexer/chunker.js';

describe('splitText', () => {
  it('returns the whole text as one chunk when shorter than target', () => {
    const out = splitText('hello world', { targetSize: 500, overlap: 50 });
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('hello world');
    expect(out[0].startChar).toBe(0);
    expect(out[0].endChar).toBe('hello world'.length);
  });

  it('splits on paragraph boundaries when possible', () => {
    const text = `${'a'.repeat(300)}\n\n${'b'.repeat(300)}\n\n${'c'.repeat(300)}`;
    const out = splitText(text, { targetSize: 350, overlap: 0 });
    expect(out.length).toBeGreaterThanOrEqual(2);
    // First chunk should end at or near a paragraph break
    expect(out[0].text.includes('a'.repeat(300))).toBe(true);
  });

  it('overlaps chunks by approximately the configured amount', () => {
    const text = 'A'.repeat(2000);
    const out = splitText(text, { targetSize: 500, overlap: 100 });
    expect(out.length).toBeGreaterThan(2);
    // Adjacent chunks should share some characters
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startChar).toBeLessThan(out[i - 1].endChar);
    }
  });

  it('rejects targetSize <= overlap', () => {
    expect(() =>
      splitText('hi', { targetSize: 100, overlap: 100 })
    ).toThrow(/overlap/);
  });
});

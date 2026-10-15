import { describe, it, expect } from 'vitest';
import { applyToolDirective } from '../../app/src/canvas/dispatcher';
import { isNoModelError } from '../../app/src/components/NoModelNotice';

function editorWith(existing: { type: string; meta?: Record<string, unknown> }[]) {
  const calls: { props: Record<string, unknown>; meta?: Record<string, unknown> }[] = [];
  const editor = {
    getCurrentPageShapes: () =>
      existing.map((s, i) => ({ id: 'shape:e' + i, x: 5000 + i * 400, y: 5000, props: { w: 10, h: 10 }, ...s })),
    getShapePageBounds: () => null,
    getViewportPageBounds: () => ({ x: 0, y: 0, w: 1200, h: 800 }),
    createShape: (s: { props: Record<string, unknown>; meta?: Record<string, unknown> }) => calls.push(s),
  };
  return { editor: editor as never, calls };
}

const place = {
  type: 'place' as const,
  id: 't1',
  kind: 'time' as const,
  role: 'primary' as const,
  payload: { mode: 'timer', durationSec: 1500 },
};

describe('first widget on a fresh canvas', () => {
  it('keeps a normal multi-widget answer expanded', () => {
    const real = ['markdown', 'tasks', 'chart', 'table'].map((k) => ({ type: 'opencanvas:' + k, meta: {} }));
    const { editor, calls } = editorWith(real);
    applyToolDirective(editor, place, 'ask-anything');
    expect(calls[0]!.props['h']).toBeGreaterThan(44);
  });

  it('opens expanded even though three welcome samples are present', () => {
    const seeds = ['markdown', 'tasks', 'sticky-note'].map((k) => ({
      type: 'opencanvas:' + k,
      meta: { seed: true },
    }));
    const { editor, calls } = editorWith(seeds);
    applyToolDirective(editor, place, 'ask-anything');
    expect(calls[0]!.props['h']).toBeGreaterThan(44);
    expect(calls[0]!.meta?.['collapsed']).toBeUndefined();
  });

  it('still auto-collapses once eight real widgets exist', () => {
    const real = ['markdown', 'tasks', 'chart', 'table', 'kanban', 'time', 'markdown', 'tasks'].map((k) => ({ type: 'opencanvas:' + k, meta: {} }));
    const { editor, calls } = editorWith(real);
    applyToolDirective(editor, place, 'ask-anything');
    expect(calls[0]!.props['h']).toBe(44);
  });
});

describe('isNoModelError', () => {
  it('recognises keyless provider failures', () => {
    expect(isNoModelError(new Error('SDK error: authentication_failed'))).toBe(true);
    expect(isNoModelError(new Error('401 Incorrect API key provided'))).toBe(true);
    expect(isNoModelError(new Error('connect ECONNREFUSED 127.0.0.1:11434'))).toBe(true);
  });
  it('ignores unrelated errors and the backend token guard', () => {
    expect(isNoModelError(undefined)).toBe(false);
    expect(isNoModelError(new Error('Failed to fetch'))).toBe(false);
    expect(
      isNoModelError(new Error('unauthorized: Pass the token in the X-OpenCanvas-Token header.')),
    ).toBe(false);
  });
});

import { contentSize } from '../../app/src/canvas/dispatcher';
describe('contentSize (tables fit their rows)', () => {
  const cols = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  it('grows with rows so nothing is clipped', () => {
    const six = contentSize('table', { columns: cols, rows: Array(6).fill(['x', 'y', 'z']) })!;
    const two = contentSize('table', { columns: cols, rows: Array(2).fill(['x', 'y', 'z']) })!;
    expect(six.h - two.h).toBe(4 * 34);
    expect(six.h).toBe(44 + 24 + 34 + 6 * 34);
  });
  it('caps very long tables and widens per column', () => {
    expect(contentSize('table', { columns: cols, rows: Array(200).fill([]) })!.h).toBe(44 + 24 + 34 + 14 * 34);
    expect(contentSize('table', { columns: Array(8).fill({ key: 'k' }), rows: [] })!.w).toBe(860);
  });
  it('sizes task lists to their items', () => {
    expect(contentSize('tasks', { items: [{ text: 'a' }] })!.h).toBe(44 + 24 + 40 + 8);
    expect(contentSize('tasks', { items: Array(50).fill({ text: 'a' }) })!.h).toBe(420);
  });
  it('leaves other kinds to the template', () => {
    expect(contentSize('markdown', { body: 'x' })).toBeNull();
  });
});

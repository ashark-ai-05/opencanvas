import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  tidyCanvas,
  maybeAutoTidyAfterPlace,
  resetAutoTidyFlag,
} from '../../app/src/canvas/tidy';

vi.mock('../../app/src/state/template-store', () => ({
  useTemplateStore: {
    getState: () => ({ activeTemplateId: 'ask-anything' }),
  },
}));

vi.mock('../../app/src/canvas/templates', () => ({
  TEMPLATES_BY_ID: {
    'ask-anything': {
      slotForRole: (_role: string, i: number, vp: { x: number; y: number; w: number }) => ({
        x: vp.x + 40,
        y: vp.y + 40 + i * 220,
        w: 320,
        h: 200,
      }),
    },
  },
}));

vi.mock('../../app/src/canvas/dispatcher', () => ({
  placementBounds: () => ({ x: 0, y: 0, w: 800, h: 600 }),
}));

function fakeEditor(shapes: Array<{ id: string; type: string; meta?: Record<string, unknown>; x?: number; y?: number; props?: { w?: number; h?: number } }>) {
  const moves: unknown[] = [];
  return {
    moves,
    getCurrentPageShapes: () => shapes,
    batch: (fn: () => void) => fn(),
    updateShape: (s: unknown) => moves.push(['update', s]),
    animateShape: (s: unknown) => moves.push(['animate', s]),
    zoomToFit: vi.fn(),
  };
}

describe('tidyCanvas', () => {
  it('lays out opencanvas widgets into role slots and skips other shapes', () => {
    const editor = fakeEditor([
      { id: 'shape:a', type: 'opencanvas:markdown', meta: { role: 'primary' }, x: 900, y: 10 },
      { id: 'shape:b', type: 'opencanvas:tasks', meta: { role: 'detail', seed: true }, x: 900, y: 20 },
      { id: 'shape:c', type: 'geo', x: 0, y: 0 },
    ]);
    const n = tidyCanvas(editor as never, { animate: false, forceGrid: true });
    expect(n).toBe(2);
    // Width updates + position updates for each of 2 shapes.
    expect(editor.moves.length).toBeGreaterThanOrEqual(2);
    const xs = editor.moves
      .filter((m) => (m as [string])[0] === 'update')
      .map((m) => (m as [string, { x?: number }])[1].x)
      .filter((x): x is number => typeof x === 'number');
    expect(xs[0]).toBe(24);
    expect(xs[1]).toBeGreaterThan(24);
  });
});

describe('maybeAutoTidyAfterPlace', () => {
  beforeEach(() => {
    resetAutoTidyFlag();
    vi.useFakeTimers();
  });
  it('fires once after two non-seed widgets are on the canvas', () => {
    const editor = fakeEditor([
      { id: 'shape:s', type: 'opencanvas:markdown', meta: { seed: true, role: 'primary' } },
      { id: 'shape:u1', type: 'opencanvas:time', meta: { role: 'primary' } },
      { id: 'shape:u2', type: 'opencanvas:tasks', meta: { role: 'detail' } },
    ]);
    maybeAutoTidyAfterPlace(editor as never);
    maybeAutoTidyAfterPlace(editor as never); // debounced: one tidy only
    expect(editor.moves).toHaveLength(0);
    vi.runAllTimers();
    const afterFirst = editor.moves.length;
    expect(afterFirst).toBeGreaterThan(0);
    // Flag set → never again on this canvas.
    maybeAutoTidyAfterPlace(editor as never);
    vi.runAllTimers();
    expect(editor.moves.length).toBe(afterFirst);
  });
  it('does not fire for welcome seeds alone', () => {
    const editor = fakeEditor([
      { id: 'shape:s1', type: 'opencanvas:markdown', meta: { seed: true } },
      { id: 'shape:s2', type: 'opencanvas:tasks', meta: { seed: true } },
      { id: 'shape:s3', type: 'opencanvas:sticky-note', meta: { seed: true } },
    ]);
    maybeAutoTidyAfterPlace(editor as never);
    vi.runAllTimers();
    expect(editor.moves).toHaveLength(0);
  });
});

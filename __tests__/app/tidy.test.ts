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
    zoomToBounds: vi.fn(),
    getCurrentPageBounds: () => ({ x: 0, y: 0, w: 800, h: 1400 }),
    getViewportScreenBounds: () => ({ w: 1000 }),
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

describe('wide widgets', () => {
  beforeEach(() => resetAutoTidyFlag());
  it('gives tables a full grid row after the regular cards', () => {
    const editor = fakeEditor([
      { id: 'shape:t', type: 'opencanvas:table', props: { w: 520, h: 300 } },
      { id: 'shape:a', type: 'opencanvas:markdown', props: { h: 180 } },
      { id: 'shape:b', type: 'opencanvas:time', props: { h: 180 } },
    ]);
    tidyCanvas(editor as never, { animate: false, forceGrid: true });
    const pos = new Map<string, { x?: number; y?: number; w?: number }>();
    for (const [, s] of editor.moves as Array<[string, { id: string; x?: number; y?: number; props?: { w?: number } }]>) {
      const cur = pos.get(s.id) ?? {};
      if (s.x != null) Object.assign(cur, { x: s.x, y: s.y });
      if (s.props?.w != null) cur.w = s.props.w;
      pos.set(s.id, cur);
    }
    const t = pos.get('shape:t')!;
    const a = pos.get('shape:a')!;
    const b = pos.get('shape:b')!;
    expect(a.y).toBe(b.y);
    expect(t.x).toBe(a.x);
    expect(t.y!).toBeGreaterThan(a.y!);
    // Spans both columns: wider than a single card.
    expect(t.w!).toBeGreaterThan(a.w!);
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
  it('soft re-tidies once the canvas grows by SOFT_RETIDY_GROWTH', () => {
    const shapes: Array<{ id: string; type: string; meta?: Record<string, unknown> }> = [
      { id: 'shape:u1', type: 'opencanvas:time', meta: {} },
      { id: 'shape:u2', type: 'opencanvas:tasks', meta: {} },
    ];
    const editor = fakeEditor(shapes);
    maybeAutoTidyAfterPlace(editor as never);
    vi.runAllTimers();
    const first = editor.moves.length;
    expect(first).toBeGreaterThan(0);
    vi.advanceTimersByTime(1000);
    editor.zoomToFit.mockClear();
    // Grow by 3: below threshold → no re-tidy.
    for (let i = 3; i <= 5; i++) shapes.push({ id: `shape:u${i}`, type: 'opencanvas:markdown' });
    maybeAutoTidyAfterPlace(editor as never);
    vi.runAllTimers();
    expect(editor.moves.length).toBe(first);
    // 4th new widget crosses the threshold.
    shapes.push({ id: 'shape:u6', type: 'opencanvas:markdown' });
    maybeAutoTidyAfterPlace(editor as never);
    vi.runAllTimers();
    expect(editor.moves.length).toBeGreaterThan(first);
    // Six 200px cards in 2 cols overflow the 600px mock viewport → fit.
    expect(editor.zoomToBounds).toHaveBeenCalled();
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

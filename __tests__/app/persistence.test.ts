import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadCanvasSnapshot,
  saveCanvasSnapshot,
  clearCanvasSnapshot,
  CANVAS_STORAGE_KEY,
} from '../../app/src/canvas/persistence';

describe('canvas persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no snapshot is stored', () => {
    expect(loadCanvasSnapshot()).toBeNull();
  });

  it('round-trips a snapshot through localStorage', () => {
    const fake = { document: { foo: 1 }, session: { bar: 2 } };
    saveCanvasSnapshot(fake as never);
    const loaded = loadCanvasSnapshot();
    expect(loaded).toEqual(fake);
  });

  it('returns null and warns when stored JSON is malformed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(CANVAS_STORAGE_KEY, 'not json');
    expect(loadCanvasSnapshot()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('clearCanvasSnapshot removes the stored entry', () => {
    saveCanvasSnapshot({ document: {}, session: {} } as never);
    clearCanvasSnapshot();
    expect(loadCanvasSnapshot()).toBeNull();
  });
});

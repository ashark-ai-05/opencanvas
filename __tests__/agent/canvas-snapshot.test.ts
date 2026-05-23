import { describe, it, expect } from 'vitest';
import {
  parseCanvasSnapshot,
  EMPTY_SNAPSHOT,
  type CanvasSnapshot,
} from '../../src/agent/canvas-snapshot.js';

describe('canvas-snapshot', () => {
  it('parses a valid snapshot', () => {
    const raw = {
      activeTemplateId: 'ask-anything',
      widgets: [
        {
          id: 'w-1',
          kind: 'markdown',
          role: 'primary',
          title: 'auth overview',
          payload: { title: 'auth', body: 'JWT-based' },
        },
      ],
    };
    const snap: CanvasSnapshot = parseCanvasSnapshot(raw);
    expect(snap.activeTemplateId).toBe('ask-anything');
    expect(snap.widgets).toHaveLength(1);
    expect(snap.widgets[0]?.id).toBe('w-1');
  });

  it('returns EMPTY_SNAPSHOT when input is undefined', () => {
    expect(parseCanvasSnapshot(undefined)).toEqual(EMPTY_SNAPSHOT);
  });

  it('returns EMPTY_SNAPSHOT when input is malformed', () => {
    expect(parseCanvasSnapshot({ widgets: 'not-an-array' })).toEqual(
      EMPTY_SNAPSHOT,
    );
  });

  it('rejects unknown templateId by falling back to default', () => {
    const snap = parseCanvasSnapshot({
      activeTemplateId: 'made-up',
      widgets: [],
    });
    expect(snap.activeTemplateId).toBe('ask-anything');
  });

  it('drops malformed widgets but keeps valid ones', () => {
    const snap = parseCanvasSnapshot({
      activeTemplateId: 'ask-anything',
      widgets: [
        { id: 'w-1', kind: 'markdown', role: 'primary', title: 't', payload: {} },
        { id: 'w-2', kind: 'unknown-kind', role: 'primary', title: 't', payload: {} },
      ],
    });
    expect(snap.widgets).toHaveLength(1);
    expect(snap.widgets[0]?.id).toBe('w-1');
  });
});

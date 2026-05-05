import { describe, it, expect } from 'vitest';
import { computeCanvasSnapshot } from '../../app/src/canvas/snapshot';

const makeEditor = () => ({
  getCurrentPageShapes: () => [
    {
      id: 'shape:w-1',
      type: 'opencanvas:markdown',
      meta: { role: 'primary' },
      props: { title: 'auth', body: 'body' },
    },
    {
      id: 'shape:other',
      type: 'geo',
      meta: {},
      props: {},
    },
  ],
});

describe('computeCanvasSnapshot', () => {
  it('serializes only opencanvas shapes, mapping shape type → kind', () => {
    const snap = computeCanvasSnapshot(makeEditor() as never, 'ask-anything');
    expect(snap.activeTemplateId).toBe('ask-anything');
    expect(snap.widgets).toHaveLength(1);
    expect(snap.widgets[0]!.id).toBe('w-1');
    expect(snap.widgets[0]!.kind).toBe('markdown');
    expect(snap.widgets[0]!.title).toBe('auth');
  });

  it('falls back to role:primary when meta.role is missing', () => {
    const snap = computeCanvasSnapshot(
      {
        getCurrentPageShapes: () => [
          {
            id: 'shape:w-2',
            type: 'opencanvas:ticket',
            meta: {},
            props: { title: 't', ticketId: 'X-1', status: 'open' },
          },
        ],
      } as never,
      'ask-anything',
    );
    expect(snap.widgets[0]!.role).toBe('primary');
  });

  it('strips the "shape:" prefix from ids', () => {
    const snap = computeCanvasSnapshot(
      {
        getCurrentPageShapes: () => [
          {
            id: 'shape:abc-123',
            type: 'opencanvas:markdown',
            meta: { role: 'detail' },
            props: { title: 't', body: 'b' },
          },
        ],
      } as never,
      'tell-me-about-x',
    );
    expect(snap.widgets[0]!.id).toBe('abc-123');
    expect(snap.activeTemplateId).toBe('tell-me-about-x');
  });

  it('returns an empty widgets array for an empty canvas', () => {
    const snap = computeCanvasSnapshot(
      { getCurrentPageShapes: () => [] } as never,
      'ask-anything',
    );
    expect(snap.widgets).toHaveLength(0);
  });

  it('falls back to shape id for title when props.title is missing', () => {
    const snap = computeCanvasSnapshot(
      {
        getCurrentPageShapes: () => [
          {
            id: 'shape:w-x',
            type: 'opencanvas:web-embed',
            meta: { role: 'reference' },
            props: { url: 'https://example.com' },
          },
        ],
      } as never,
      'ask-anything',
    );
    expect(snap.widgets[0]!.title).toBe('shape:w-x');
  });
});

import { describe, it, expect } from 'vitest';
import { readCanvasTool } from '../../../src/agent/tools/read-canvas.js';
import type { CanvasSnapshot } from '../../../src/agent/canvas-snapshot.js';

const snap: CanvasSnapshot = {
  activeTemplateId: 'ask-anything',
  widgets: [
    {
      id: 'w-1',
      kind: 'markdown',
      role: 'primary',
      title: 'auth',
      payload: { title: 'auth', body: 'long body' },
    },
    {
      id: 'w-2',
      kind: 'ticket',
      role: 'detail',
      title: 'TICKET-101',
      payload: { ticketId: 'TICKET-101', title: 'rate limits', status: 'open' },
    },
  ],
};

describe('read_canvas', () => {
  it('returns summary only — no payload field', async () => {
    const handler = readCanvasTool(() => snap).handler;
    const r = await handler({}, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.widgets).toHaveLength(2);
    expect(out.widgets[0]).toEqual({
      id: 'w-1',
      kind: 'markdown',
      role: 'primary',
      title: 'auth',
    });
    expect(out.widgets[0]).not.toHaveProperty('payload');
  });

  it('reflects snapshot changes between calls (closure captures live ref)', async () => {
    let current: CanvasSnapshot = { ...snap, widgets: [] };
    const handler = readCanvasTool(() => current).handler;

    const a = JSON.parse((await handler({}, undefined)).content[0]!.text!);
    expect(a.widgets).toHaveLength(0);

    current = snap;
    const b = JSON.parse((await handler({}, undefined)).content[0]!.text!);
    expect(b.widgets).toHaveLength(2);
  });
});

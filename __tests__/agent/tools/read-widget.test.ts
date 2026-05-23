import { describe, it, expect } from 'vitest';
import { readWidgetTool } from '../../../src/agent/tools/read-widget.js';
import type { CanvasSnapshot } from '../../../src/agent/canvas-snapshot.js';

const snap: CanvasSnapshot = {
  activeTemplateId: 'ask-anything',
  widgets: [
    {
      id: 'w-1',
      kind: 'markdown',
      role: 'primary',
      title: 'auth',
      payload: { title: 'auth', body: 'JWT-based auth' },
    },
  ],
};

describe('read_widget', () => {
  it('returns the full widget when id matches', async () => {
    const handler = readWidgetTool(() => snap).handler;
    const r = await handler({ id: 'w-1' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.widget.payload.body).toBe('JWT-based auth');
  });

  it('returns isError when id not found', async () => {
    const handler = readWidgetTool(() => snap).handler;
    const r = await handler({ id: 'nope' }, undefined);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('not found');
  });
});

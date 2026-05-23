import { describe, it, expect } from 'vitest';
import { clearCanvasTool } from '../../../src/agent/tools/clear-canvas.js';
import type { CanvasSnapshot } from '../../../src/agent/canvas-snapshot.js';

const snap: CanvasSnapshot = {
  activeTemplateId: 'ask-anything',
  widgets: [
    { id: 'w-1', kind: 'markdown', role: 'primary', title: 't', payload: {} },
    { id: 'w-2', kind: 'ticket', role: 'detail', title: 't', payload: {} },
  ],
};

describe('clear_canvas', () => {
  it('returns clear directive and the count of removed widgets', async () => {
    const handler = clearCanvasTool(() => snap).handler;
    const r = await handler({}, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.ok).toBe(true);
    // removedIds was replaced with removedCount to avoid echoing all widget
    // ids back to the agent (token waste — agent already has the snapshot).
    expect(out.removedCount).toBe(2);
    expect(out.removedIds).toBeUndefined();
    expect(out.directive).toEqual({ type: 'clear' });
  });
});

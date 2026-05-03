import { describe, it, expect } from 'vitest';
import { focusWidgetTool } from '../../../src/agent/tools/focus-widget.js';

describe('focus_widget', () => {
  it('returns ok and a focus directive', async () => {
    const handler = focusWidgetTool().handler;
    const r = await handler({ id: 'w-1' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.ok).toBe(true);
    expect(out.directive).toEqual({ type: 'focus', id: 'w-1' });
  });
});

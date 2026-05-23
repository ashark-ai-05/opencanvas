import { describe, it, expect } from 'vitest';
import { linkWidgetsTool } from '../../../src/agent/tools/link-widgets.js';

describe('link_widgets', () => {
  it('returns linkId + link directive', async () => {
    const handler = linkWidgetsTool().handler;
    const r = await handler(
      { fromId: 'w-1', toId: 'w-2', label: 'implements' },
      undefined,
    );
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.ok).toBe(true);
    expect(out.linkId).toEqual(expect.any(String));
    expect(out.directive).toEqual({
      type: 'link',
      linkId: out.linkId,
      fromId: 'w-1',
      toId: 'w-2',
      label: 'implements',
    });
  });

  it('omits label when not provided', async () => {
    const handler = linkWidgetsTool().handler;
    const r = await handler({ fromId: 'a', toId: 'b' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.directive.label).toBeUndefined();
  });

  it('rejects self-links', async () => {
    const handler = linkWidgetsTool().handler;
    const r = await handler({ fromId: 'a', toId: 'a' }, undefined);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('self-link');
  });
});

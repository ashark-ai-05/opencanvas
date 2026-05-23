import { describe, it, expect } from 'vitest';
import { switchTemplateTool } from '../../../src/agent/tools/switch-template.js';

describe('switch_template', () => {
  it('returns switchTemplate directive for a valid template id', async () => {
    const handler = switchTemplateTool().handler;
    const r = await handler({ id: 'tell-me-about-x' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.ok).toBe(true);
    expect(out.directive).toEqual({
      type: 'switchTemplate',
      id: 'tell-me-about-x',
    });
  });

  it('rejects unknown template id (Zod enum)', async () => {
    const handler = switchTemplateTool().handler;
    // @ts-expect-error testing runtime guard
    const r = await handler({ id: 'made-up' }, undefined);
    expect(r.isError).toBe(true);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { fetchResultTool } from '../../../src/agent/tools/fetch-result.js';

describe('fetch_result', () => {
  it('returns the full payload by id', async () => {
    const svc = {
      fetchById: vi.fn().mockResolvedValue({
        id: 'docs:auth',
        kind: 'text-document',
        title: 'auth overview',
        payload: { body: 'JWT-based authentication...' },
        source: 'docs',
      }),
    };
    const handler = fetchResultTool(svc as never).handler;
    const r = await handler({ id: 'docs:auth' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.result.id).toBe('docs:auth');
    expect(out.result.payload.body).toContain('JWT');
  });

  it('returns isError when id not found', async () => {
    const svc = { fetchById: vi.fn().mockResolvedValue(null) };
    const handler = fetchResultTool(svc as never).handler;
    const r = await handler({ id: 'nope' }, undefined);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('not found');
  });
});

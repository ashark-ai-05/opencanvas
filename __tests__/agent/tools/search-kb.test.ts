import { describe, it, expect, vi } from 'vitest';
import { searchKbTool } from '../../../src/agent/tools/search-kb.js';

const fakeSearchService = (results: unknown[]) => ({
  search: vi.fn().mockResolvedValue(results),
});

describe('search_kb', () => {
  it('returns summary-only results (no full payloads)', async () => {
    const svc = fakeSearchService([
      {
        id: 'docs:auth',
        kind: 'text-document',
        title: 'auth overview',
        snippet: 'JWT...',
        score: 0.92,
        source: 'docs',
        payload: { body: 'a long body that should not be returned' },
      },
    ]);
    const handler = searchKbTool(svc as never).handler;
    const r = await handler({ query: 'auth' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).not.toHaveProperty('payload');
    expect(out.results[0]).toEqual({
      id: 'docs:auth',
      kind: 'text-document',
      title: 'auth overview',
      snippet: 'JWT...',
      score: 0.92,
      source: 'docs',
    });
  });

  it('clamps limit to 25', async () => {
    const svc = fakeSearchService([]);
    const handler = searchKbTool(svc as never).handler;
    await handler({ query: 'x', limit: 999 }, undefined);
    expect(svc.search).toHaveBeenCalledWith('x', 25, undefined);
  });

  it('defaults limit to 10', async () => {
    const svc = fakeSearchService([]);
    const handler = searchKbTool(svc as never).handler;
    await handler({ query: 'x' }, undefined);
    expect(svc.search).toHaveBeenCalledWith('x', 10, undefined);
  });

  it('fans out to every variant and reports which ones were searched', async () => {
    const svc = {
      search: vi.fn().mockResolvedValue([
        { id: '1', kind: 'doc', title: 't1', snippet: 's1', score: 0.5, source: 'kb' },
      ]),
    };
    const handler = searchKbTool(svc as never).handler;
    const r = await handler(
      { query: 'auth flow', queries: ['JWT middleware', 'login session'] },
      undefined,
    );
    const out = JSON.parse(r.content[0]!.text!);
    // 1 canonical + 2 variants = 3 search calls
    expect(svc.search).toHaveBeenCalledTimes(3);
    expect(out.variantsSearched).toEqual([
      'auth flow',
      'JWT middleware',
      'login session',
    ]);
    // Same hit appears in all 3 lists → fused into one result
    expect(out.results).toHaveLength(1);
  });

  it('forwards options.project when scoping to a KB project', async () => {
    const svc = fakeSearchService([]);
    const handler = searchKbTool(svc as never).handler;
    await handler({ query: 'q', project: 'my-svc' }, undefined);
    expect(svc.search).toHaveBeenCalledWith('q', 10, { project: 'my-svc' });
  });

  it('returns warning when search throws "index not ready"', async () => {
    const svc = {
      search: vi.fn().mockRejectedValue(new Error('index not ready')),
    };
    const handler = searchKbTool(svc as never).handler;
    const r = await handler({ query: 'x' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.results).toEqual([]);
    expect(out.warning).toContain('index');
  });
});

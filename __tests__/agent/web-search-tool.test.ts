import { describe, it, expect, vi } from 'vitest';
import { webSearchTool, type WebSearchProvider } from '../../src/agent/tools/web-search.js';

function makeProvider(stub: WebSearchProvider['search']): WebSearchProvider {
  return { search: stub };
}

async function callTool(
  provider: WebSearchProvider,
  args: { query: string; limit?: number },
) {
  const tool = webSearchTool(provider);
  const r = await tool.handler(args, {} as never);
  return JSON.parse(r.content[0]!.text);
}

describe('webSearchTool', () => {
  it('forwards query + clamped limit to the provider', async () => {
    const search = vi.fn().mockResolvedValue([]);
    await callTool(makeProvider(search), { query: 'tldraw 3 release notes', limit: 3 });
    expect(search).toHaveBeenCalledWith('tldraw 3 release notes', 3);
  });

  it('uses a default limit of 5 when not given', async () => {
    const search = vi.fn().mockResolvedValue([]);
    await callTool(makeProvider(search), { query: 'q' });
    expect(search).toHaveBeenCalledWith('q', 5);
  });

  it('clamps limit to a max of 10', async () => {
    const search = vi.fn().mockResolvedValue([]);
    await callTool(makeProvider(search), { query: 'q', limit: 999 });
    expect(search).toHaveBeenCalledWith('q', 10);
  });

  it('returns provider results in the standard envelope', async () => {
    const search = vi.fn().mockResolvedValue([
      {
        id: 'web:example.com:0',
        kind: 'web',
        title: 'Example',
        snippet: 'About',
        url: 'https://example.com',
        source: 'example.com',
        score: 0.9,
      },
    ]);
    const out = await callTool(makeProvider(search), { query: 'example' });
    expect(out.results).toHaveLength(1);
    expect(out.results[0].url).toBe('https://example.com');
    expect(out.results[0].kind).toBe('web');
  });

  it('catches provider errors and returns an empty + warning result', async () => {
    const search = vi.fn().mockRejectedValue(new Error('Tavily HTTP 401'));
    const out = await callTool(makeProvider(search), { query: 'q' });
    expect(out.results).toEqual([]);
    expect(out.warning).toMatch(/Tavily HTTP 401/);
  });
});

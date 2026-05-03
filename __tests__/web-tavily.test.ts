import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TavilyProvider, createWebSearchProvider } from '../src/web/tavily.js';

const ORIG_FETCH = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn() as never;
});
afterEach(() => {
  globalThis.fetch = ORIG_FETCH;
});

function mockFetchOk(payload: unknown): void {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Response(JSON.stringify(payload), { status: 200 }),
  );
}

function mockFetchStatus(status: number, body = ''): void {
  (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
    new Response(body, { status }),
  );
}

describe('TavilyProvider', () => {
  it('throws when no api key is set', async () => {
    const p = new TavilyProvider({ apiKey: '' });
    await expect(p.search('q', 3)).rejects.toThrow(/TAVILY_API_KEY/);
  });

  it('hits the search endpoint with query + max_results', async () => {
    mockFetchOk({ results: [] });
    const p = new TavilyProvider({ apiKey: 'k-1' });
    await p.search('hello world', 4);
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.tavily.com/search');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.query).toBe('hello world');
    expect(body.max_results).toBe(4);
  });

  it('maps Tavily results into the WebSearchResult envelope', async () => {
    mockFetchOk({
      results: [
        {
          title: 'tldraw 3 release notes',
          url: 'https://github.com/tldraw/tldraw/releases/tag/v3.0',
          content: 'tldraw 3 introduces …',
          score: 0.92,
        },
      ],
    });
    const p = new TavilyProvider({ apiKey: 'k-1' });
    const r = await p.search('tldraw 3 release', 5);
    expect(r).toHaveLength(1);
    expect(r[0]!.kind).toBe('web');
    expect(r[0]!.url).toBe('https://github.com/tldraw/tldraw/releases/tag/v3.0');
    expect(r[0]!.source).toBe('github.com');
    expect(r[0]!.score).toBe(0.92);
    expect(r[0]!.id).toMatch(/^web:github\.com:0$/);
  });

  it('surfaces non-2xx as Error("Tavily HTTP …")', async () => {
    mockFetchStatus(401, 'unauthorized');
    const p = new TavilyProvider({ apiKey: 'bad-key' });
    await expect(p.search('q', 3)).rejects.toThrow(/Tavily HTTP 401/);
  });

  it('truncates long content to a 280-char snippet', async () => {
    const long = 'x'.repeat(500);
    mockFetchOk({ results: [{ title: 't', url: 'https://a.test', content: long, score: 0.5 }] });
    const p = new TavilyProvider({ apiKey: 'k' });
    const r = await p.search('q', 1);
    expect(r[0]!.snippet.length).toBe(281); // 280 + '…'
    expect(r[0]!.snippet.endsWith('…')).toBe(true);
  });
});

describe('createWebSearchProvider', () => {
  const ORIG_KEY = process.env['TAVILY_API_KEY'];
  afterEach(() => {
    if (ORIG_KEY === undefined) delete process.env['TAVILY_API_KEY'];
    else process.env['TAVILY_API_KEY'] = ORIG_KEY;
  });

  it('returns an empty-results stub when TAVILY_API_KEY is unset', async () => {
    delete process.env['TAVILY_API_KEY'];
    const p = createWebSearchProvider();
    const r = await p.search('whatever', 5);
    expect(r).toEqual([]);
  });

  it('returns a real TavilyProvider when TAVILY_API_KEY is set', async () => {
    process.env['TAVILY_API_KEY'] = 'test-key';
    mockFetchOk({ results: [] });
    const p = createWebSearchProvider();
    await p.search('q', 1);
    expect(globalThis.fetch).toHaveBeenCalled();
  });
});

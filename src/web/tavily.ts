import type { WebSearchProvider, WebSearchResult } from '../agent/tools/web-search.js';

/**
 * Tavily web search provider. https://tavily.com
 *
 * Auth: TAVILY_API_KEY env var (free tier: 1000 searches/month).
 * No SDK dependency — Tavily's API is a single POST so we use fetch directly.
 */

interface TavilyResultRaw {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results?: TavilyResultRaw[];
  answer?: string;
  query?: string;
}

export class TavilyProvider implements WebSearchProvider {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(opts: { apiKey: string; endpoint?: string } = { apiKey: '' }) {
    this.apiKey = opts.apiKey;
    this.endpoint = opts.endpoint ?? 'https://api.tavily.com/search';
  }

  async search(query: string, limit: number): Promise<WebSearchResult[]> {
    if (!this.apiKey) {
      throw new Error(
        'TAVILY_API_KEY is not set. Add it to .env or set TAVILY_API_KEY=… before launching the backend.',
      );
    }

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        query,
        max_results: limit,
        search_depth: 'basic',
        include_answer: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Tavily HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as TavilyResponse;
    const raw = json.results ?? [];

    return raw.map((r, i) => {
      let host = '';
      try {
        host = new URL(r.url).host;
      } catch {
        host = r.url;
      }
      return {
        id: `web:${host}:${i}`,
        kind: 'web' as const,
        title: r.title,
        snippet: r.content.length > 280 ? `${r.content.slice(0, 280)}…` : r.content,
        url: r.url,
        source: host,
        score: r.score,
      };
    });
  }
}

/**
 * Factory: returns a real TavilyProvider if TAVILY_API_KEY is set,
 * otherwise a stub that throws a clear "not configured" error so the
 * tool surface tells the agent (and ultimately the user) what to fix
 * instead of silently returning empty — which previously caused the
 * agent to fall back to other tools and produce confusing UX.
 */
export function createWebSearchProvider(): WebSearchProvider {
  const key = process.env['TAVILY_API_KEY'] ?? '';
  if (!key) {
    return {
      async search(): Promise<WebSearchResult[]> {
        throw new Error(
          'web_search is not configured: TAVILY_API_KEY is not set. ' +
            'Add it to .env (free tier: https://app.tavily.com) and restart the backend.',
        );
      },
    };
  }
  return new TavilyProvider({ apiKey: key });
}

import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { WithArgs } from './_shared.js';

/**
 * Web search tool — currently backed by Tavily (https://tavily.com).
 *
 * Auth: TAVILY_API_KEY env var. Free tier: 1000 searches/month, no card.
 * The interface below is provider-agnostic so swapping to Brave/Serper
 * later is one file plus one env var.
 *
 * Result shape mirrors `search_kb`'s envelope so the model can fluidly
 * blend KB + web hits in a single answer.  Each result has the same
 * id/kind/title/snippet/source fields, plus a `url` so place_widget can
 * mint a `web-embed` widget directly from the id without a fetch step.
 */

export interface WebSearchResult {
  id: string;
  kind: 'web';
  title: string;
  snippet: string;
  url: string;
  /** Source = the result's host, mirroring search_kb's source==sourceId convention. */
  source: string;
  /** Raw relevance score from the provider (Tavily returns 0..1). */
  score?: number;
}

export interface WebSearchProvider {
  search(query: string, limit: number): Promise<WebSearchResult[]>;
}

interface WebSearchArgs {
  query: string;
  limit?: number;
}

const inputShape = {
  query: z.string().describe('search query — pass the user\'s topic verbatim or a tightened version'),
  limit: z
    .number()
    .int()
    .positive()
    .max(10)
    .optional()
    .describe('max results, default 5, max 10'),
};

type WebSearchToolDef = WithArgs<typeof inputShape, WebSearchArgs>;

export function webSearchTool(provider: WebSearchProvider): WebSearchToolDef {
  const def = tool(
    'web_search',
    `Search the public web for current information. Use when the answer needs to come from outside the indexed knowledge base — recent news, library docs, prices, or anything time-sensitive.

Returns: { results: [{ id, kind: "web", title, snippet, url, source, score }] }

After search_kb returns nothing, prefer web_search over apologizing. The id can be passed to place_widget kind=web-embed (payload: { title, url, snippet }).`,
    inputShape,
    async (args) => {
      const limit = Math.min(args.limit ?? 5, 10);
      try {
        const results = await provider.search(args.query, limit);
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ results }) },
          ],
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                results: [],
                warning: `web_search failed: ${message}`,
              }),
            },
          ],
        };
      }
    },
  );
  return def as unknown as WebSearchToolDef;
}

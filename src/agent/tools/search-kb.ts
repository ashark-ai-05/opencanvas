import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { WithArgs } from './_shared.js';

interface SearchServiceLike {
  search(query: string, limit: number): Promise<
    Array<{
      id: string;
      kind: string;
      title: string;
      snippet: string;
      score: number;
      source: string;
    }>
  >;
}

/** Public args type — limit is truly optional so tests can omit it. */
export interface SearchKbArgs {
  query: string;
  limit?: number;
}

const inputShape = {
  query: z.string().describe('search query'),
  limit: z
    .number()
    .int()
    .positive()
    .max(25)
    .optional()
    .describe('max results, default 10, max 25'),
};

type SearchKbToolDef = WithArgs<typeof inputShape, SearchKbArgs>;

/**
 * Factory: builds the search_kb SdkMcpToolDefinition bound to a search service.
 * The service interface is intentionally narrow so tests can inject a fake.
 */
export function searchKbTool(service: SearchServiceLike): SearchKbToolDef {
  const def = tool(
    'search_kb',
    'Search indexed knowledge (code, docs, tickets). Returns summary results.',
    inputShape,
    async (args) => {
      const limit = Math.min(args.limit ?? 10, 25);
      try {
        const results = await service.search(args.query, limit);
        const summary = results.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          snippet: r.snippet,
          score: r.score,
          source: r.source,
        }));
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ results: summary }) },
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
                warning: `search failed: ${message}`,
              }),
            },
          ],
        };
      }
    },
  );
  // Cast handler to accept optional limit (SDK's InferShape makes all keys
  // required even for ZodOptional fields; the runtime behaviour is identical).
  return def as unknown as SearchKbToolDef;
}

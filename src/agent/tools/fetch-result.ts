import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { WithArgs } from './_shared.js';

interface FetchByIdServiceLike {
  fetchById(id: string): Promise<{
    id: string;
    kind: string;
    title: string;
    payload: Record<string, unknown>;
    source: string;
  } | null>;
}

const inputShape = {
  id: z.string().describe('search result id from search_kb'),
};

type FetchResultToolDef = WithArgs<typeof inputShape, { id: string }>;

export function fetchResultTool(service: FetchByIdServiceLike): FetchResultToolDef {
  const def = tool(
    'fetch_result',
    'Fetch the full payload of a search result by id.',
    inputShape,
    async (args) => {
      const result = await service.fetchById(args.id);
      if (!result) {
        return {
          content: [
            { type: 'text' as const, text: `result not found for id: ${args.id}` },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ result }) }],
      };
    },
  );
  return def as unknown as FetchResultToolDef;
}

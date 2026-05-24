import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import { z } from 'zod';
import type { OpenCanvasToolCtx, SearchServiceLike, WithArgs } from './_shared.js';

const inputShape = {
  id: z.string().describe('search result id from search_kb'),
};
const inputSchema = z.object(inputShape);

interface FetchResultArgs {
  id: string;
}

type FetchResultOutput =
  | {
      result: {
        id: string;
        kind: string;
        title: string;
        payload: Record<string, unknown>;
        source: string;
      };
    }
  | { error: string; notFound: true };

const TOOL_DESCRIPTION = 'Fetch the full payload of a search result by id.';

/** Shared body — both v1 and v2 builders close over this. */
async function executeFetchResult(
  service: Pick<SearchServiceLike, 'fetchById'>,
  args: FetchResultArgs,
): Promise<FetchResultOutput> {
  const result = await service.fetchById(args.id);
  if (!result) {
    return { error: `result not found for id: ${args.id}`, notFound: true };
  }
  return { result };
}

// ─── v1 (Claude SDK) — kept intact during migration ────────────────────
type FetchResultToolDef = WithArgs<typeof inputShape, FetchResultArgs>;

export function fetchResultTool(
  service: Pick<SearchServiceLike, 'fetchById'>,
): FetchResultToolDef {
  const def = claudeTool(
    'fetch_result',
    TOOL_DESCRIPTION,
    inputShape,
    async (args) => {
      const out = await executeFetchResult(service, args);
      if ('notFound' in out) {
        return {
          content: [{ type: 'text' as const, text: out.error }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(out) }],
      };
    },
  );
  return def as unknown as FetchResultToolDef;
}

// ─── v2 (AI SDK) — the future ──────────────────────────────────────────
export const fetchResultToolV2 = (ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema,
    execute: async (args) => executeFetchResult(ctx.search, args),
  });

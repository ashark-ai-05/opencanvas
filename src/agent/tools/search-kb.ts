import { z } from 'zod';
import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import type { OpenCanvasToolCtx, SearchServiceLike, WithArgs } from './_shared.js';

/**
 * Public args type — `query` is canonical; `queries` is 0-6 semantic
 * variants (synonyms, expanded acronyms, hypothetical answer phrasings,
 * alternative terminology). The agent's prompt instructs it to provide
 * 2-4 variants whenever non-trivial; the runtime tool fuses across all
 * variants via reciprocal rank fusion (k=60), the same RRF the
 * SearchService uses internally to merge FTS + vec.
 *
 */
export interface SearchKbArgs {
  query: string;
  queries?: string[];
  limit?: number;
  project?: string;
}

const inputShape = {
  query: z
    .string()
    .describe(
      'canonical phrasing of what the user wants — used as the primary query',
    ),
  queries: z
    .array(z.string())
    .max(6)
    .optional()
    .describe(
      '0-6 semantic variants (synonyms, expanded acronyms, alternative phrasings). Fused across via RRF.',
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(25)
    .optional()
    .describe('max results, default 10, max 25'),
  project: z
    .string()
    .optional()
    .describe(
      'optional project name to scope KB results (matches knowledgeBase.projects[].name)',
    ),
};

type SearchKbToolDef = WithArgs<typeof inputShape, SearchKbArgs>;

/** RRF fuse two ranked lists using k=60. Stable on duplicate ids. */
const RRF_K = 60;

type Hit = {
  id: string;
  kind: string;
  title: string;
  snippet: string;
  score: number;
  source: string;
};

function rrfFuse(lists: Hit[][], limit: number): Hit[] {
  const fused = new Map<string, { score: number; hit: Hit }>();
  for (const list of lists) {
    list.forEach((hit, i) => {
      const rank = i + 1;
      const existing = fused.get(hit.id);
      const contrib = 1 / (RRF_K + rank);
      if (existing) {
        existing.score += contrib;
      } else {
        fused.set(hit.id, { score: contrib, hit });
      }
    });
  }
  return Array.from(fused.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, hit }) => ({ ...hit, score }));
}

const TOOL_DESCRIPTION =
  'Search indexed knowledge (code, docs, tickets, prior conversations). Pass `query` as the canonical phrasing AND 2-4 semantic variants as `queries` for better recall — variants get fused via RRF.';

/** Shared body — both v1 and v2 builders close over this. */
async function executeSearchKb(
  service: SearchServiceLike,
  args: SearchKbArgs,
): Promise<{ results: Hit[]; variantsSearched: string[]; warning?: string }> {
  const limit = Math.min(args.limit ?? 10, 25);
  const variants = [
    args.query,
    ...(args.queries ?? []).filter(
      (q) => typeof q === 'string' && q.trim().length > 0,
    ),
  ];
  const options = args.project ? { project: args.project } : undefined;
  try {
    const lists = await Promise.all(
      variants.map((v) => service.search(v, limit, options)),
    );
    const fused = lists.length > 1 ? rrfFuse(lists, limit) : (lists[0] ?? []).slice(0, limit);
    return {
      results: fused.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.title,
        snippet: r.snippet,
        score: r.score,
        source: r.source,
      })),
      variantsSearched: variants,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      results: [],
      variantsSearched: variants,
      warning: `search failed: ${message}`,
    };
  }
}

// ─── v1 (Claude SDK) ────────────────────────────────────────────────────
/**
 * Factory: builds the search_kb SdkMcpToolDefinition bound to a search service.
 * The service interface is intentionally narrow so tests can inject a fake.
 */
export function searchKbTool(service: SearchServiceLike): SearchKbToolDef {
  const def = claudeTool(
    'search_kb',
    TOOL_DESCRIPTION,
    inputShape,
    async (args) => {
      const out = await executeSearchKb(service, args);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(out) }],
      };
    },
  );
  return def as unknown as SearchKbToolDef;
}

// ─── v2 (AI SDK) ────────────────────────────────────────────────────────
export const searchKbToolV2 = (ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema: z.object(inputShape),
    execute: async (args) => executeSearchKb(ctx.search, args),
  });

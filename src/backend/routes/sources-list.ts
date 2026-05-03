import { Hono } from 'hono';
import type { BackendState } from '../state.js';

/**
 * GET /v1/sources/list
 *
 * Returns every distinct source_id present in the chunks table along
 * with its chunk count + most-recent insert time. Drives the Sources
 * popover in the header — visualizes the KB literally growing as
 * conversations get indexed back, code/docs get added, etc.
 *
 * Cheap: a single GROUP BY query against an indexed column.
 */
type SourceRow = {
  source_id: string;
  chunk_count: number;
  last_indexed: number | null;
  kinds: string;
};

export function sourcesListRoute(state: BackendState): Hono {
  const r = new Hono();

  r.get('/v1/sources/list', async (c) => {
    const store = await state.getStore();
    const rows = store.db
      .prepare(
        `SELECT source_id,
                COUNT(*) AS chunk_count,
                MAX(created_at) AS last_indexed,
                GROUP_CONCAT(DISTINCT kind) AS kinds
         FROM chunks
         GROUP BY source_id
         ORDER BY MAX(created_at) DESC`,
      )
      .all() as SourceRow[];

    const sources = rows.map((row) => ({
      id: row.source_id,
      chunkCount: row.chunk_count,
      lastIndexed: row.last_indexed,
      kinds: (row.kinds ?? '').split(',').filter(Boolean),
      // Categorize by id prefix so the UI can group: code / docs /
      // conversations / MCP. The id format we use:
      //   - local-code:./path
      //   - local:./path  (docs)
      //   - conversation:<conv-id>
      //   - <mcp-source-id>  (no prefix — falls into 'other')
      category: categorize(row.source_id),
    }));

    return c.json({
      sources,
      total: sources.length,
      totalChunks: sources.reduce((acc, s) => acc + s.chunkCount, 0),
    });
  });

  return r;
}

function categorize(
  sourceId: string,
): 'code' | 'docs' | 'conversation' | 'other' {
  if (sourceId.startsWith('local-code:')) return 'code';
  if (sourceId.startsWith('local:')) return 'docs';
  if (sourceId.startsWith('conversation:')) return 'conversation';
  return 'other';
}

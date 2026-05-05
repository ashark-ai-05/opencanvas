import type { Store } from '../storage/store.js';
import type { EmbeddingProvider } from '../core/embedding-provider.js';
import { titleFromUri } from './title.js';

/**
 * Agent-friendly search result. Matches the `AgentToolDeps['search']`
 * contract in src/agent/tools/index.ts so SearchService can be passed to
 * `buildAgentTools` directly with no adapter.
 */
export type SearchResult = {
  id: string; // String(chunks.id)
  kind: string; // chunks.kind
  title: string; // meta.title ?? titleFromUri(uri)
  snippet: string; // body truncated to ~200 chars
  score: number; // RRF score
  source: string; // chunks.source_id
};

export type FetchByIdResult = {
  id: string;
  kind: string;
  title: string;
  payload: Record<string, unknown>; // {body, uri, ...meta}
  source: string;
};

export type SearchOptions = {
  /**
   * When set, filter to chunks whose `meta_json.project` matches. Used by
   * `pnpm cli --kb-search <name>` and the `mcp__strata__search_kb` tool when
   * it forwards a project hint from the agent.
   */
  project?: string;
};

export type SearchServiceOptions = {
  store: Store;
  embedder: EmbeddingProvider;
};

export const RRF_K = 60;
export const DEFAULT_LIMIT = 10;
export const CANDIDATE_LIMIT = 50;
export const SNIPPET_LEN = 200;

type ChunkRow = {
  chunk_id: number;
  source_id: string;
  kind: string;
  uri: string;
  body: string;
  meta_json: string | null;
};

export class SearchService {
  private readonly store: Store;
  private readonly embedder: EmbeddingProvider;

  constructor(options: SearchServiceOptions) {
    this.store = options.store;
    this.embedder = options.embedder;
  }

  /**
   * Hybrid search:
   *  - FTS5 MATCH for keyword/BM25 ranking
   *  - sqlite-vec MATCH for vector similarity
   *  - merged via reciprocal rank fusion (RRF, k=60)
   *
   * When `options.project` is set, both branches are scoped to that
   * project via `json_extract(meta_json, '$.project')`. The vector branch
   * over-fetches and post-filters because vec0 cannot AND with regular
   * predicates inside its MATCH clause.
   */
  async search(
    query: string,
    limit: number = DEFAULT_LIMIT,
    options: SearchOptions = {},
  ): Promise<SearchResult[]> {
    const ftsExpr = escapeFtsQuery(query);

    // BM25 rank (FTS5 returns negative bm25; lower is better).
    let ftsRows: ChunkRow[] = [];
    if (ftsExpr.length > 0) {
      try {
        if (options.project) {
          ftsRows = this.store.db
            .prepare(
              `SELECT chunks.id AS chunk_id, chunks.source_id, chunks.kind,
                      chunks.uri, chunks.body, chunks.meta_json
               FROM fts JOIN chunks ON chunks.id = fts.rowid
               WHERE fts MATCH ?
                 AND json_extract(chunks.meta_json, '$.project') = ?
               ORDER BY bm25(fts)
               LIMIT ?`,
            )
            .all(ftsExpr, options.project, CANDIDATE_LIMIT) as ChunkRow[];
        } else {
          ftsRows = this.store.db
            .prepare(
              `SELECT chunks.id AS chunk_id, chunks.source_id, chunks.kind,
                      chunks.uri, chunks.body, chunks.meta_json
               FROM fts JOIN chunks ON chunks.id = fts.rowid
               WHERE fts MATCH ?
               ORDER BY bm25(fts)
               LIMIT ?`,
            )
            .all(ftsExpr, CANDIDATE_LIMIT) as ChunkRow[];
        }
      } catch {
        // FTS query may fail on special tokens; fall through to vector-only.
      }
    }

    // Vector rank.
    const [queryVec] = await this.embedder.embed([query]);
    const vecLimit = options.project ? CANDIDATE_LIMIT * 4 : CANDIDATE_LIMIT;
    const vecRowsRaw = this.store.db
      .prepare(
        `SELECT embeddings.chunk_id, chunks.source_id, chunks.kind,
                chunks.uri, chunks.body, chunks.meta_json, distance
         FROM embeddings JOIN chunks ON chunks.id = embeddings.chunk_id
         WHERE embedding MATCH ?
           AND k = ?
         ORDER BY distance`,
      )
      .all(Buffer.from(queryVec.buffer), vecLimit) as (ChunkRow & {
      distance: number;
    })[];

    let vecRows: ChunkRow[] = vecRowsRaw;
    if (options.project) {
      vecRows = vecRows
        .filter((row) => {
          const meta = parseMeta(row.meta_json);
          return meta['project'] === options.project;
        })
        .slice(0, CANDIDATE_LIMIT);
    }

    // RRF: score = sum(1 / (RRF_K + rank))
    const fusedScores = new Map<number, { score: number; row: ChunkRow }>();

    const accumulate = (rows: ChunkRow[]): void => {
      rows.forEach((row, i) => {
        const rank = i + 1;
        const entry = fusedScores.get(row.chunk_id) ?? { score: 0, row };
        entry.score += 1 / (RRF_K + rank);
        fusedScores.set(row.chunk_id, entry);
      });
    };

    accumulate(ftsRows);
    accumulate(vecRows);

    return Array.from(fusedScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score, row }) => {
        const meta = parseMeta(row.meta_json);
        const metaTitle =
          typeof meta['title'] === 'string' ? (meta['title'] as string) : undefined;
        return {
          id: String(row.chunk_id),
          kind: row.kind,
          title: metaTitle ?? titleFromUri(row.uri),
          snippet: makeSnippet(row.body),
          score,
          source: row.source_id,
        };
      });
  }

  /**
   * Fetch a single chunk by its agent-tool id (stringified chunks.id).
   * Returns null for unknown or malformed ids — never throws on bad input.
   */
  async fetchById(id: string): Promise<FetchByIdResult | null> {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return null;
    }

    const row = this.store.db
      .prepare(
        `SELECT id, source_id, kind, uri, body, meta_json
         FROM chunks WHERE id = ?`,
      )
      .get(numericId) as
      | {
          id: number;
          source_id: string;
          kind: string;
          uri: string;
          body: string;
          meta_json: string | null;
        }
      | undefined;

    if (!row) return null;

    const meta = parseMeta(row.meta_json);
    const metaTitle =
      typeof meta['title'] === 'string' ? (meta['title'] as string) : undefined;
    return {
      id: String(row.id),
      kind: row.kind,
      title: metaTitle ?? titleFromUri(row.uri),
      payload: { body: row.body, uri: row.uri, ...meta },
      source: row.source_id,
    };
  }
}

/**
 * Tokenise the user query into FTS5-safe terms.
 * Strategy: lowercase, run-of-`[a-z0-9_]{2,}` tokens, double-quote each, OR them.
 * Empty / no-token queries return '' so the caller can skip the FTS branch
 * cleanly (vector-only fallback).
 *
 * Spec reference: REPLICATION-PROMPT.md §5.
 */
export function escapeFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .match(/[a-z0-9_]{2,}/g);
  if (!tokens || tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(' OR ');
}

function parseMeta(metaJson: string | null): Record<string, unknown> {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function makeSnippet(body: string): string {
  return body.length > SNIPPET_LEN ? `${body.slice(0, SNIPPET_LEN)}…` : body;
}

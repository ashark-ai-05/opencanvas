import type { Store } from '../storage/store.js';
import type { EmbeddingProvider } from '../core/embedding-provider.js';
import { titleFromUri } from './title.js';

/**
 * Agent-friendly search result. Matches the `AgentToolDeps['search']`
 * contract in src/agent/tools/index.ts so SearchService can be passed to
 * `buildAgentTools` directly with no adapter.
 */
export type SearchResult = {
  id: string;       // String(chunks.id)
  kind: string;     // chunks.kind
  title: string;    // meta.title ?? titleFromUri(uri)
  snippet: string;  // body truncated to ~200 chars
  score: number;    // RRF score
  source: string;  // chunks.source_id
};

export type FetchByIdResult = {
  id: string;
  kind: string;
  title: string;
  payload: Record<string, unknown>; // {body, uri, ...meta}
  source: string;
};

export type SearchServiceOptions = {
  store: Store;
  embedder: EmbeddingProvider;
};

const RRF_K = 60;
const DEFAULT_LIMIT = 10;
const CANDIDATE_LIMIT = 50;
const SNIPPET_LEN = 200;

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
   * Returns the agent-tool shape directly (no adapter needed).
   */
  async search(query: string, limit: number = DEFAULT_LIMIT): Promise<SearchResult[]> {
    // BM25 rank (FTS5 returns negative bm25; lower is better → invert order)
    let ftsRows: ChunkRow[] = [];
    try {
      ftsRows = this.store.db
        .prepare(
          `SELECT chunks.id AS chunk_id, chunks.source_id, chunks.kind,
                  chunks.uri, chunks.body, chunks.meta_json
           FROM fts JOIN chunks ON chunks.id = fts.rowid
           WHERE fts MATCH ?
           ORDER BY bm25(fts)
           LIMIT ?`
        )
        .all(this.escapeFtsQuery(query), CANDIDATE_LIMIT) as ChunkRow[];
    } catch {
      // FTS query may fail on special tokens; fall through to vector-only
    }

    // Vector rank
    const [queryVec] = await this.embedder.embed([query]);
    const vecRows = this.store.db
      .prepare(
        `SELECT embeddings.chunk_id, chunks.source_id, chunks.kind,
                chunks.uri, chunks.body, chunks.meta_json, distance
         FROM embeddings JOIN chunks ON chunks.id = embeddings.chunk_id
         WHERE embedding MATCH ?
           AND k = ?
         ORDER BY distance`
      )
      .all(Buffer.from(queryVec.buffer), CANDIDATE_LIMIT) as (ChunkRow & {
        distance: number;
      })[];

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
        const metaTitle = typeof meta['title'] === 'string' ? (meta['title'] as string) : undefined;
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
         FROM chunks WHERE id = ?`
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
    const metaTitle = typeof meta['title'] === 'string' ? (meta['title'] as string) : undefined;
    return {
      id: String(row.id),
      kind: row.kind,
      title: metaTitle ?? titleFromUri(row.uri),
      payload: { body: row.body, uri: row.uri, ...meta },
      source: row.source_id,
    };
  }

  /**
   * FTS5 has special characters that must be quoted to be treated as
   * literals. For v1 we simply quote the entire query as a phrase
   * (preserves all characters); accuracy gains from term-level escaping
   * can come in 3a.1 if needed.
   */
  private escapeFtsQuery(query: string): string {
    // Replace any double-quote with two double-quotes (FTS5 escape), then wrap.
    return `"${query.replace(/"/g, '""')}"`;
  }
}

function parseMeta(metaJson: string | null): Record<string, unknown> {
  if (!metaJson) return {};
  try {
    const parsed = JSON.parse(metaJson);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function makeSnippet(body: string): string {
  return body.length > SNIPPET_LEN ? `${body.slice(0, SNIPPET_LEN)}…` : body;
}

import type { Store } from '../storage/store.js';
import type { EmbeddingProvider } from '../core/embedding-provider.js';

export type SearchResult = {
  chunkId: number;
  sourceId: string;
  uri: string;
  body: string;
  score: number;
};

export type SearchOptions = {
  limit?: number;
};

export type SearchServiceOptions = {
  store: Store;
  embedder: EmbeddingProvider;
};

const RRF_K = 60;
const DEFAULT_LIMIT = 10;
const CANDIDATE_LIMIT = 50;

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
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const limit = options.limit ?? DEFAULT_LIMIT;

    // BM25 rank (FTS5 returns negative bm25; lower is better → invert order)
    let ftsRows: { chunk_id: number; source_id: string; uri: string; body: string }[] = [];
    try {
      ftsRows = this.store.db
        .prepare(
          `SELECT chunks.id AS chunk_id, chunks.source_id, chunks.uri, chunks.body
           FROM fts JOIN chunks ON chunks.id = fts.rowid
           WHERE fts MATCH ?
           ORDER BY bm25(fts)
           LIMIT ?`
        )
        .all(this.escapeFtsQuery(query), CANDIDATE_LIMIT) as typeof ftsRows;
    } catch {
      // FTS query may fail on special tokens; fall through to vector-only
    }

    // Vector rank
    const [queryVec] = await this.embedder.embed([query]);
    const vecRows = this.store.db
      .prepare(
        `SELECT embeddings.chunk_id, chunks.source_id, chunks.uri, chunks.body, distance
         FROM embeddings JOIN chunks ON chunks.id = embeddings.chunk_id
         WHERE embedding MATCH ?
           AND k = ?
         ORDER BY distance`
      )
      .all(Buffer.from(queryVec.buffer), CANDIDATE_LIMIT) as {
        chunk_id: number;
        source_id: string;
        uri: string;
        body: string;
        distance: number;
      }[];

    // RRF: score = sum(1 / (RRF_K + rank))
    const fusedScores = new Map<
      number,
      { score: number; row: { chunk_id: number; source_id: string; uri: string; body: string } }
    >();

    ftsRows.forEach((row, i) => {
      const rank = i + 1;
      const entry = fusedScores.get(row.chunk_id) ?? {
        score: 0,
        row: { chunk_id: row.chunk_id, source_id: row.source_id, uri: row.uri, body: row.body },
      };
      entry.score += 1 / (RRF_K + rank);
      fusedScores.set(row.chunk_id, entry);
    });

    vecRows.forEach((row, i) => {
      const rank = i + 1;
      const entry = fusedScores.get(row.chunk_id) ?? {
        score: 0,
        row: { chunk_id: row.chunk_id, source_id: row.source_id, uri: row.uri, body: row.body },
      };
      entry.score += 1 / (RRF_K + rank);
      fusedScores.set(row.chunk_id, entry);
    });

    return Array.from(fusedScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ score, row }) => ({
        chunkId: row.chunk_id,
        sourceId: row.source_id,
        uri: row.uri,
        body: row.body,
        score,
      }));
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

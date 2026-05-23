import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Store } from '../storage/store.js';
import type { EmbeddingProvider } from '../core/embedding-provider.js';
import { splitText } from './chunker.js';
import { walkTextFiles } from './fs-walk.js';

const DEFAULT_TARGET_SIZE = 500;
const DEFAULT_OVERLAP = 50;

export type IndexResult = {
  indexedFiles: number;
  chunks: number;
  errors: { path: string; error: string }[];
};

export type DocumentIndexerOptions = {
  store: Store;
  embedder: EmbeddingProvider;
  targetSize?: number;
  overlap?: number;
};

export type RunOptions = {
  rootPath: string;
  sourceId: string;
};

export class DocumentIndexer {
  private readonly store: Store;
  private readonly embedder: EmbeddingProvider;
  private readonly targetSize: number;
  private readonly overlap: number;

  constructor(options: DocumentIndexerOptions) {
    this.store = options.store;
    this.embedder = options.embedder;
    this.targetSize = options.targetSize ?? DEFAULT_TARGET_SIZE;
    this.overlap = options.overlap ?? DEFAULT_OVERLAP;
  }

  async run(opts: RunOptions): Promise<IndexResult> {
    const errors: { path: string; error: string }[] = [];
    let indexedFiles = 0;
    let totalChunks = 0;

    const root = resolve(opts.rootPath);

    for await (const path of walkTextFiles(root)) {
      try {
        const body = await readFile(path, 'utf8');
        const chunks = splitText(body, {
          targetSize: this.targetSize,
          overlap: this.overlap,
        });
        const uri = `file://${path}`;

        // Delete prior chunks for this URI so re-runs are idempotent.
        const deleteOld = this.store.db.prepare(
          `DELETE FROM chunks WHERE source_id = ? AND uri LIKE ?`
        );
        // Delete the base URI and any fragment URIs (#chunk-N)
        deleteOld.run(opts.sourceId, `${uri}%`);

        // For multi-chunk files, store each chunk under a fragment URI.
        const chunkUris: string[] = chunks.map((_, i) =>
          chunks.length === 1 ? uri : `${uri}#chunk-${i}`
        );

        // Pre-compute embeddings for the batch.
        const vectors = await this.embedder.embed(chunks.map((c) => c.text));

        const insertChunk = this.store.db.prepare(
          `INSERT INTO chunks (source_id, kind, uri, body, meta_json, embedder_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const insertEmbedding = this.store.db.prepare(
          `INSERT INTO embeddings (chunk_id, embedding) VALUES (?, ?)`
        );

        const tx = this.store.db.transaction(() => {
          for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            const result = insertChunk.run(
              opts.sourceId,
              'text-document',
              chunkUris[i],
              c.text,
              JSON.stringify({ startChar: c.startChar, endChar: c.endChar }),
              this.embedder.id,
              Date.now()
            );
            const chunkId = BigInt(result.lastInsertRowid as bigint | number);
            insertEmbedding.run(chunkId, Buffer.from(vectors[i].buffer));
            totalChunks++;
          }
        });
        tx();

        indexedFiles++;
      } catch (e) {
        errors.push({
          path,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { indexedFiles, chunks: totalChunks, errors };
  }
}

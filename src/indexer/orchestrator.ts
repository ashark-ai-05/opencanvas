/**
 * Knowledge-base orchestrator.
 *
 * Wires connector → chunker → (optional QA enricher) → embedder → SQLite.
 * Produces idempotent runs:
 *   - re-running on unchanged upstream is a no-op
 *   - per-document DELETE before INSERT keeps `chunks` row count stable
 *   - QaEnricher's content-hash cache means re-runs make 0 LLM calls
 *
 * Spec: REPLICATION-PROMPT.md §9 + KNOWLEDGE-BASE.md.
 */
import type { Connector, RawDocument } from '../connectors/types.js';
import type { Store } from '../storage/store.js';
import type { EmbeddingProvider } from '../core/embedding-provider.js';
import { splitText } from './chunker.js';
import { extractLinks } from './link-extractor.js';
import { QaEnricher } from './qa-enricher.js';

export type OrchestratorOptions = {
  store: Store;
  embedder: EmbeddingProvider;
  enricher?: QaEnricher;
  /**
   * Logical project name. Stamped on every chunk's `meta_json.project`
   * so SearchService can scope results via `--project`.
   */
  project: string;
  /**
   * Cap LLM calls per run for cost control. 0 = unlimited.
   * Chunks past the cap fall back to raw-text embedding.
   */
  enrichLimit?: number;
  /**
   * Restrict QA enrichment to chunks whose document `kind` is in this
   * set. Empty / undefined ⇒ enrich every kind.
   */
  enrichKinds?: Set<string>;
  /** Heartbeat log interval in ms (default 30s). */
  heartbeatMs?: number;
};

export type OrchestratorRunSummary = {
  sourceId: string;
  docs: number;
  chunks: number;
  cacheHits: number;
  llmCalls: number;
  links: number;
  cursor?: string;
};

const DEFAULT_HEARTBEAT_MS = 30_000;

export class KnowledgeBaseOrchestrator {
  constructor(private readonly options: OrchestratorOptions) {}

  /** Run a single connector end-to-end. */
  async run(connector: Connector, since?: string): Promise<OrchestratorRunSummary> {
    const start = Date.now();
    let lastHeartbeat = start;
    const summary: OrchestratorRunSummary = {
      sourceId: connector.id,
      docs: 0,
      chunks: 0,
      cacheHits: 0,
      llmCalls: 0,
      links: 0,
    };

    const beforeCacheHits = this.options.enricher?.cacheHitCount ?? 0;
    const beforeLlmCalls = this.options.enricher?.llmCallCount ?? 0;

    const heartbeatMs = this.options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

    const generator = connector.run({ ...(since ? { since } : {}) });
    let cursorAfter: string | undefined;
    while (true) {
      const next = await generator.next();
      if (next.done) {
        cursorAfter = next.value?.cursorAfter;
        break;
      }
      const doc = next.value;
      const out = await this.persistDocument(doc, summary);
      summary.chunks += out.chunks;
      summary.links += out.links;
      summary.docs += 1;

      const elapsed = Date.now() - lastHeartbeat;
      if (elapsed >= heartbeatMs) {
        const totalSec = ((Date.now() - start) / 1000).toFixed(0);
        const llmDelta =
          (this.options.enricher?.llmCallCount ?? 0) - beforeLlmCalls;
        console.log(
          `[${connector.id}] progress: docs=${summary.docs} chunks=${summary.chunks} llmCalls=${llmDelta} elapsed=${totalSec}s`,
        );
        lastHeartbeat = Date.now();
      }
    }

    summary.cacheHits =
      (this.options.enricher?.cacheHitCount ?? 0) - beforeCacheHits;
    summary.llmCalls =
      (this.options.enricher?.llmCallCount ?? 0) - beforeLlmCalls;
    if (cursorAfter !== undefined) summary.cursor = cursorAfter;

    this.upsertSourceState(connector.id, cursorAfter, summary.docs);
    return summary;
  }

  /**
   * Idempotency contract: DELETE-then-INSERT every chunk for this doc
   * inside one transaction so a re-ingest of unchanged content keeps
   * the `chunks` row count stable.
   */
  private async persistDocument(
    doc: RawDocument,
    summary: OrchestratorRunSummary,
  ): Promise<{ chunks: number; links: number }> {
    const { store, embedder, enricher, project } = this.options;
    const rawChunks = splitText(doc.body, { targetSize: 1200, overlap: 100 });
    const chunks = rawChunks.map((c) => c.text);
    if (chunks.length === 0) return { chunks: 0, links: 0 };

    const baseUriPrefix = `${doc.uri}#chunk:`;
    const enrichKinds = this.options.enrichKinds;
    const enrichLimit = this.options.enrichLimit ?? 0;

    type ChunkInsert = {
      uri: string;
      body: string;
      embedding: Float32Array;
      meta: Record<string, unknown>;
      qa?: ReturnType<typeof Object.assign> | null;
    };

    // Embedding step happens BEFORE the transaction (it's async + slow);
    // the transaction below is purely synchronous SQLite I/O.
    const inserts: ChunkInsert[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i]!;
      const chunkUri = `${baseUriPrefix}${i}`;
      const meta: Record<string, unknown> = {
        ...doc.meta,
        project,
        title: doc.title,
        chunkIndex: i,
        chunkCount: chunks.length,
      };

      let qaPair: Awaited<ReturnType<QaEnricher['enrich']>> | null = null;
      const wantEnrich =
        enricher !== undefined &&
        (!enrichKinds || enrichKinds.size === 0 || enrichKinds.has(doc.kind)) &&
        (enrichLimit === 0 || summary.llmCalls + (enricher?.llmCallCount ?? 0) - (enricher?.llmCallCount ?? 0) < enrichLimit);
      if (wantEnrich && enricher) {
        const before = enricher.llmCallCount;
        qaPair = await enricher.enrich(chunkText, doc.title);
        if (qaPair === null) {
          // enrich returned null — record the skip reason in meta and
          // fall back to raw embedding. Don't penalise the connector.
          meta['enrichSkipped'] = 'error';
          if (enricher.llmCallCount > before) {
            meta['enrichError'] = 'parse_or_network';
          }
        }
      } else if (enricher !== undefined && enrichLimit > 0) {
        meta['enrichSkipped'] = 'limit';
      } else if (enrichKinds && enrichKinds.size > 0 && !enrichKinds.has(doc.kind)) {
        meta['enrichSkipped'] = 'kind-filter';
      }

      const embeddingInput = qaPair ? QaEnricher.embedText(qaPair) : chunkText;
      const [vec] = await embedder.embed([embeddingInput]);
      if (!vec) continue;

      inserts.push({
        uri: chunkUri,
        body: chunkText,
        embedding: vec,
        meta,
        qa: qaPair,
      });
    }

    let linkCount = 0;
    const tx = store.db.transaction(() => {
      // Wipe any prior chunks for this document (idempotent re-ingest).
      const wipe = store.db.prepare(
        `DELETE FROM chunks WHERE source_id = ? AND uri LIKE ?`,
      );
      wipe.run(doc.sourceId, `${baseUriPrefix}%`);

      const insertChunk = store.db.prepare(
        `INSERT INTO chunks (source_id, kind, uri, body, meta_json, embedder_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertEmbedding = store.db.prepare(
        `INSERT INTO embeddings (chunk_id, embedding) VALUES (?, ?)`,
      );
      const insertQaPair = store.db.prepare(
        `INSERT INTO qa_pairs (chunk_id, content_hash, queries_json, response_text, model, generated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const insertLink = store.db.prepare(
        `INSERT INTO links (from_chunk_id, to_uri, link_type, confidence)
         VALUES (?, ?, ?, ?)`,
      );

      for (const ins of inserts) {
        const result = insertChunk.run(
          doc.sourceId,
          doc.kind,
          ins.uri,
          ins.body,
          JSON.stringify(ins.meta),
          embedder.id,
          Date.now(),
        );
        // sqlite-vec rejects BigInt-narrowed-to-Number for vec0 PKs; bind
        // the BigInt directly (better-sqlite3 always returns BigInt for
        // lastInsertRowid in safeIntegers mode).
        const chunkId = BigInt(result.lastInsertRowid as bigint | number);
        insertEmbedding.run(chunkId, Buffer.from(ins.embedding.buffer));

        const qa = ins.qa as
          | { queries: string[]; response: string; contentHash: string; model: string }
          | null
          | undefined;
        if (qa) {
          insertQaPair.run(
            chunkId,
            qa.contentHash,
            JSON.stringify(qa.queries),
            qa.response,
            qa.model,
            Date.now(),
          );
        }

        const extractedLinks = extractLinks(ins.body);
        for (const link of extractedLinks) {
          insertLink.run(chunkId, link.toUri, link.linkType, link.confidence);
          linkCount += 1;
        }
      }
    });
    tx();

    return { chunks: inserts.length, links: linkCount };
  }

  private upsertSourceState(
    sourceId: string,
    cursor: string | undefined,
    docCount: number,
  ): void {
    const { store, project } = this.options;
    store.db
      .prepare(
        `INSERT INTO source_state (project, source_id, cursor, last_run_at, doc_count)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (project, source_id) DO UPDATE SET
           cursor = COALESCE(excluded.cursor, source_state.cursor),
           last_run_at = excluded.last_run_at,
           doc_count = source_state.doc_count + excluded.doc_count`,
      )
      .run(project, sourceId, cursor ?? null, Date.now(), docCount);
  }
}

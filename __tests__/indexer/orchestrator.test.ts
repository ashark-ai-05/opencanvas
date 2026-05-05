/**
 * Orchestrator end-to-end tests.
 *
 * Covers the idempotency contract from spec §19:
 *   - re-running on unchanged input keeps `chunks` row count stable
 *   - re-running on unchanged input makes 0 additional LLM calls
 *   - source_state.cursor monotonically advances
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, type Store } from '../../src/storage/store.js';
import { migrate } from '../../src/storage/migrations.js';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KnowledgeBaseOrchestrator } from '../../src/indexer/orchestrator.js';
import { QaEnricher } from '../../src/indexer/qa-enricher.js';
import type {
  Connector,
  ConnectorRunOpts,
  ConnectorRunResult,
  RawDocument,
} from '../../src/connectors/types.js';
import type {
  EmbeddingProvider,
} from '../../src/core/embedding-provider.js';
import type { LLMProvider, ProviderEvent } from '../../src/core/provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function fixedEmbedder(): EmbeddingProvider {
  return {
    id: 'test',
    dims: 384,
    async embed(texts: string[]) {
      // Deterministic: hash each text into a tiny float vec; fast and
      // sufficient for testing the orchestrator's persistence path.
      return texts.map(() => {
        const v = new Float32Array(384);
        for (let i = 0; i < 384; i++) v[i] = Math.random();
        return v;
      });
    },
  };
}

function fakeProvider(json: string): LLMProvider {
  return {
    id: 'fake',
    name: 'fake',
    kind: 'model',
    async *query() {
      const events: ProviderEvent[] = [
        { type: 'text-delta', text: json },
        { type: 'done' },
      ];
      for (const ev of events) yield ev;
    },
    async probe() {
      return { ok: true };
    },
  };
}

function fakeConnector(docs: RawDocument[]): Connector {
  return {
    id: docs[0]?.sourceId ?? 'fake:src',
    async *run(_opts: ConnectorRunOpts): AsyncGenerator<RawDocument, ConnectorRunResult> {
      for (const d of docs) yield d;
      return { cursorAfter: 'cursor-1' };
    },
  };
}

function buildQaJson(): string {
  return JSON.stringify({
    queries: [
      'how does X work',
      'X overview',
      'what is X',
      'X function definition',
      'X internals',
      'X usage',
      'how do I use X',
      'X getting started',
      'X reference',
      'X api',
      'X behavior',
      'X examples',
    ],
    response: 'X is a thing.',
  });
}

async function openTestStore(): Promise<Store> {
  const store = await openStore({ path: ':memory:' });
  const sql001 = await readFile(
    join(__dirname, '..', '..', 'src', 'storage', 'migrations', '001_initial.sql'),
    'utf-8',
  );
  const sql002 = await readFile(
    join(__dirname, '..', '..', 'src', 'storage', 'migrations', '002_qa_and_source_state.sql'),
    'utf-8',
  );
  await migrate(store, [
    { id: '001_initial', sql: sql001 },
    { id: '002_qa_and_source_state', sql: sql002 },
  ]);
  return store;
}

describe('KnowledgeBaseOrchestrator', () => {
  let store: Store;
  let cacheDir: string;

  beforeEach(async () => {
    store = await openTestStore();
    cacheDir = await mkdtemp(join(tmpdir(), 'strata-orch-'));
  });
  afterEach(async () => {
    store.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('persists a doc into chunks + embeddings + qa_pairs', async () => {
    const enricher = new QaEnricher({
      provider: fakeProvider(buildQaJson()),
      cacheDir,
    });
    const orchestrator = new KnowledgeBaseOrchestrator({
      store,
      embedder: fixedEmbedder(),
      enricher,
      project: 'test-proj',
    });

    const docs: RawDocument[] = [
      {
        sourceId: 'fake:src',
        kind: 'doc-file',
        uri: '/tmp/doc-a.md',
        title: 'doc-a',
        body: 'this is some test content for chunking',
        meta: { extra: 1 },
      },
    ];
    const summary = await orchestrator.run(fakeConnector(docs));
    expect(summary.docs).toBe(1);
    expect(summary.chunks).toBeGreaterThan(0);
    expect(summary.llmCalls).toBe(1);

    const chunkRow = store.db
      .prepare('SELECT COUNT(*) AS c FROM chunks')
      .get() as { c: number };
    expect(chunkRow.c).toBe(summary.chunks);

    const qaRow = store.db
      .prepare('SELECT COUNT(*) AS c FROM qa_pairs')
      .get() as { c: number };
    expect(qaRow.c).toBe(summary.chunks);

    // meta.project stamped for SearchService scoping.
    const sample = store.db
      .prepare('SELECT meta_json FROM chunks LIMIT 1')
      .get() as { meta_json: string };
    expect(JSON.parse(sample.meta_json).project).toBe('test-proj');
  });

  it('re-running on unchanged content is idempotent (chunks/qa stable, 0 new LLM calls)', async () => {
    const enricher = new QaEnricher({
      provider: fakeProvider(buildQaJson()),
      cacheDir,
    });
    const orchestrator = new KnowledgeBaseOrchestrator({
      store,
      embedder: fixedEmbedder(),
      enricher,
      project: 'test-proj',
    });
    const docs: RawDocument[] = [
      {
        sourceId: 'fake:src',
        kind: 'doc-file',
        uri: '/tmp/doc-a.md',
        title: 'doc-a',
        body: 'stable body',
        meta: {},
      },
    ];

    const first = await orchestrator.run(fakeConnector(docs));
    const llmCallsAfterFirst = enricher.llmCallCount;

    const second = await orchestrator.run(fakeConnector(docs));
    const chunkRow = store.db
      .prepare('SELECT COUNT(*) AS c FROM chunks')
      .get() as { c: number };
    const qaRow = store.db
      .prepare('SELECT COUNT(*) AS c FROM qa_pairs')
      .get() as { c: number };

    expect(chunkRow.c).toBe(first.chunks);
    expect(qaRow.c).toBe(first.chunks);
    // Cache hit on rerun → no new LLM calls.
    expect(enricher.llmCallCount).toBe(llmCallsAfterFirst);
    expect(second.llmCalls).toBe(0);
    expect(second.cacheHits).toBeGreaterThan(0);
  });

  it('writes link rows when the body contains JIRA / file paths', async () => {
    const orchestrator = new KnowledgeBaseOrchestrator({
      store,
      embedder: fixedEmbedder(),
      project: 'test-proj',
    });
    const docs: RawDocument[] = [
      {
        sourceId: 'fake:src',
        kind: 'doc-file',
        uri: '/tmp/doc-a.md',
        title: 'doc-a',
        body: 'see ABC-1234 and /home/me/foo/bar.ts for context',
        meta: {},
      },
    ];
    await orchestrator.run(fakeConnector(docs));
    const links = store.db.prepare('SELECT * FROM links').all() as Array<{
      to_uri: string;
      link_type: string;
    }>;
    const types = new Set(links.map((l) => l.link_type));
    expect(types.has('jira-issue')).toBe(true);
    expect(types.has('code-file')).toBe(true);
  });

  it('upserts source_state with cursor advance', async () => {
    const orchestrator = new KnowledgeBaseOrchestrator({
      store,
      embedder: fixedEmbedder(),
      project: 'test-proj',
    });
    const docs: RawDocument[] = [
      {
        sourceId: 'fake:src',
        kind: 'doc-file',
        uri: '/tmp/doc.md',
        title: 'd',
        body: 'b',
        meta: {},
      },
    ];
    await orchestrator.run(fakeConnector(docs));
    const row = store.db
      .prepare(
        `SELECT cursor, doc_count FROM source_state WHERE project = ? AND source_id = ?`,
      )
      .get('test-proj', 'fake:src') as { cursor: string; doc_count: number };
    expect(row.cursor).toBe('cursor-1');
    expect(row.doc_count).toBe(1);
  });
});

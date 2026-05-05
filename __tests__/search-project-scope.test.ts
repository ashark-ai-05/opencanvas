/**
 * SearchService.search should filter by project when scoped.
 *
 * Spec: REPLICATION-PROMPT.md §5 + KNOWLEDGE-BASE.md "Project-scoped search".
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore, type Store } from '../src/storage/store.js';
import { migrate } from '../src/storage/migrations.js';
import { SearchService } from '../src/search/service.js';
import type { EmbeddingProvider } from '../src/core/embedding-provider.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function deterministicEmbedder(): EmbeddingProvider {
  // Same fixed vector for every input; that's fine for the project-scope
  // test because we're asserting on the project filter, not vector
  // ranking.
  return {
    id: 'test',
    dims: 384,
    async embed(texts: string[]) {
      return texts.map(() => {
        const v = new Float32Array(384);
        for (let i = 0; i < 384; i++) v[i] = 0.5;
        return v;
      });
    },
  };
}

async function openTestStore(): Promise<Store> {
  const store = await openStore({ path: ':memory:' });
  const sql001 = await readFile(
    join(__dirname, '..', 'src', 'storage', 'migrations', '001_initial.sql'),
    'utf-8',
  );
  const sql002 = await readFile(
    join(__dirname, '..', 'src', 'storage', 'migrations', '002_qa_and_source_state.sql'),
    'utf-8',
  );
  await migrate(store, [
    { id: '001_initial', sql: sql001 },
    { id: '002_qa_and_source_state', sql: sql002 },
  ]);
  return store;
}

async function insertChunk(
  store: Store,
  embedder: EmbeddingProvider,
  args: { sourceId: string; uri: string; body: string; project: string },
): Promise<void> {
  const meta = JSON.stringify({ project: args.project, title: args.uri });
  const result = store.db
    .prepare(
      `INSERT INTO chunks (source_id, kind, uri, body, meta_json, embedder_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(args.sourceId, 'doc-file', args.uri, args.body, meta, embedder.id, Date.now());
  // sqlite-vec rejects Number-narrowed BigInts for vec0 PKs.
  const chunkId = BigInt(result.lastInsertRowid as bigint | number);
  const [vec] = await embedder.embed([args.body]);
  store.db
    .prepare(`INSERT INTO embeddings (chunk_id, embedding) VALUES (?, ?)`)
    .run(chunkId, Buffer.from(vec!.buffer));
}

describe('SearchService project filter', () => {
  let store: Store;
  let svc: SearchService;
  const embedder = deterministicEmbedder();

  beforeEach(async () => {
    store = await openTestStore();
    svc = new SearchService({ store, embedder });
    await insertChunk(store, embedder, {
      sourceId: 'code:projA',
      uri: '/proj-a/file.ts',
      body: 'authentication middleware verify jwt',
      project: 'proj-a',
    });
    await insertChunk(store, embedder, {
      sourceId: 'code:projB',
      uri: '/proj-b/file.ts',
      body: 'authentication middleware verify jwt',
      project: 'proj-b',
    });
  });
  afterEach(() => store.close());

  it('returns hits from both projects when no scope is set', async () => {
    const hits = await svc.search('authentication', 10);
    const sources = new Set(hits.map((h) => h.source));
    expect(sources.size).toBe(2);
  });

  it('scopes hits to a single project when options.project is set', async () => {
    const hits = await svc.search('authentication', 10, { project: 'proj-a' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.source === 'code:projA')).toBe(true);
  });

  it('returns [] when scoping to an unknown project', async () => {
    const hits = await svc.search('authentication', 10, {
      project: 'nope',
    });
    expect(hits).toEqual([]);
  });
});

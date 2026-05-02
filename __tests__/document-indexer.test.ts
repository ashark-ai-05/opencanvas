import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, loadInitialMigrations } from '../src/storage/store.js';
import { migrate } from '../src/storage/migrations.js';
import { DocumentIndexer } from '../src/indexer/document-indexer.js';
import type { EmbeddingProvider } from '../src/core/embedding-provider.js';

class FakeEmbedder implements EmbeddingProvider {
  readonly id = 'fake';
  readonly name = 'Fake';
  readonly dims = 384;
  readonly capabilities = { batchSize: 32, offline: true };
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(this.dims);
      const seed = t.charCodeAt(0) || 1;
      for (let i = 0; i < this.dims; i++) v[i] = (seed % (i + 7)) / 100;
      return v;
    });
  }
  async probe() {
    return { ok: true as const, dims: this.dims };
  }
}

describe('DocumentIndexer', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'llm-wiki-doc-test-'));
    writeFileSync(join(fixtureDir, 'a.md'), '# Title A\n\nThis is body A with content.');
    writeFileSync(join(fixtureDir, 'b.txt'), 'Plain text body B with different content.');
  });

  afterAll(() => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('indexes every .md/.txt file in a directory', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new FakeEmbedder();

    const indexer = new DocumentIndexer({ store, embedder });
    const result = await indexer.run({ rootPath: fixtureDir, sourceId: 'fixtures' });

    expect(result.indexedFiles).toBe(2);
    expect(result.chunks).toBeGreaterThanOrEqual(2);
    expect(result.errors).toEqual([]);

    const chunkCount = (
      store.db.prepare('SELECT count(*) AS c FROM chunks').get() as { c: number }
    ).c;
    expect(chunkCount).toBeGreaterThanOrEqual(2);

    const embCount = (
      store.db.prepare('SELECT count(*) AS c FROM embeddings').get() as { c: number }
    ).c;
    expect(embCount).toBe(chunkCount);

    store.close();
  });

  it('is idempotent on re-run (no duplicate chunks)', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new FakeEmbedder();
    const indexer = new DocumentIndexer({ store, embedder });

    await indexer.run({ rootPath: fixtureDir, sourceId: 'fixtures' });
    const firstCount = (
      store.db.prepare('SELECT count(*) AS c FROM chunks').get() as { c: number }
    ).c;

    await indexer.run({ rootPath: fixtureDir, sourceId: 'fixtures' });
    const secondCount = (
      store.db.prepare('SELECT count(*) AS c FROM chunks').get() as { c: number }
    ).c;

    expect(secondCount).toBe(firstCount);
    store.close();
  });
});

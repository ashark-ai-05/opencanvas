import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, loadInitialMigrations } from '../src/storage/store.js';
import { migrate } from '../src/storage/migrations.js';
import { DocumentIndexer } from '../src/indexer/document-indexer.js';
import { SearchService } from '../src/search/service.js';
import type { EmbeddingProvider } from '../src/core/embedding-provider.js';

class DeterministicEmbedder implements EmbeddingProvider {
  readonly id = 'deterministic';
  readonly name = 'Deterministic';
  readonly dims = 384;
  readonly capabilities = { batchSize: 32, offline: true };
  async embed(texts: string[]): Promise<Float32Array[]> {
    // Embedding strategy: vector hashes characters into dims so
    // texts with the same vocabulary cluster together.
    return texts.map((t) => {
      const v = new Float32Array(this.dims);
      for (const ch of t.toLowerCase()) {
        v[ch.charCodeAt(0) % this.dims] += 1;
      }
      // L2-normalise
      let n = 0;
      for (let i = 0; i < this.dims; i++) n += v[i] * v[i];
      n = Math.sqrt(n) || 1;
      for (let i = 0; i < this.dims; i++) v[i] /= n;
      return v;
    });
  }
  async probe() {
    return { ok: true as const, dims: this.dims };
  }
}

describe('SearchService', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'llm-wiki-search-test-'));
    writeFileSync(join(fixtureDir, 'apples.md'), 'Apples are red and tasty fruit.');
    writeFileSync(join(fixtureDir, 'oranges.md'), 'Oranges are orange and citrus fruit.');
    writeFileSync(join(fixtureDir, 'cars.md'), 'Cars are vehicles with four wheels.');
  });

  afterAll(() => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('finds keyword matches via BM25', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new DeterministicEmbedder();
    await new DocumentIndexer({ store, embedder }).run({
      rootPath: fixtureDir,
      sourceId: 'fruits',
    });

    const service = new SearchService({ store, embedder });
    const results = await service.search('apples', 3);
    expect(results.length).toBeGreaterThan(0);
    expect(typeof results[0].id).toBe('string');
    expect(results[0].kind).toBe('text-document');
    expect(results[0].source).toBe('fruits');
    expect(typeof results[0].title).toBe('string');
    expect(typeof results[0].score).toBe('number');
    expect(results[0].snippet.toLowerCase()).toContain('apple');
    store.close();
  });

  it('returns at most `limit` results', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new DeterministicEmbedder();
    await new DocumentIndexer({ store, embedder }).run({
      rootPath: fixtureDir,
      sourceId: 'fruits',
    });

    const service = new SearchService({ store, embedder });
    const results = await service.search('fruit', 1);
    expect(results.length).toBeLessThanOrEqual(1);
    store.close();
  });

  it('blends BM25 and vector ranks (RRF)', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new DeterministicEmbedder();
    await new DocumentIndexer({ store, embedder }).run({
      rootPath: fixtureDir,
      sourceId: 'fruits',
    });

    const service = new SearchService({ store, embedder });
    const results = await service.search('citrus orange', 3);
    expect(results[0].snippet.toLowerCase()).toContain('orange');
    store.close();
  });
});

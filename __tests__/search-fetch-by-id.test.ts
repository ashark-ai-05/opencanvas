import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
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
    return texts.map((t) => {
      const v = new Float32Array(this.dims);
      for (const ch of t.toLowerCase()) {
        v[ch.charCodeAt(0) % this.dims] += 1;
      }
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

describe('SearchService.fetchById', () => {
  it('returns null for an unknown id', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new DeterministicEmbedder();
    const svc = new SearchService({ store, embedder });
    const r = await svc.fetchById('999999');
    expect(r).toBeNull();
    store.close();
  });

  it('returns full payload when id matches an indexed chunk', async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 'svc-fetch-'));
    mkdirSync(join(fixtureDir, 'docs'), { recursive: true });
    writeFileSync(join(fixtureDir, 'docs/apple.md'), '# Apple\nThe apple is a fruit.');

    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new DeterministicEmbedder();
    await new DocumentIndexer({ store, embedder }).run({
      rootPath: fixtureDir,
      sourceId: 'fruits',
    });

    const svc = new SearchService({ store, embedder });
    const results = await svc.search('apple', 1);
    expect(results.length).toBeGreaterThan(0);
    const r = await svc.fetchById(results[0]!.id);
    expect(r).not.toBeNull();
    expect(r!.id).toBe(results[0]!.id);
    expect(r!.kind).toBe('text-document');
    expect(r!.source).toBe('fruits');
    expect(r!.payload).toBeDefined();
    expect(typeof (r!.payload as { body?: unknown }).body).toBe('string');
    expect((r!.payload as { body: string }).body.toLowerCase()).toContain('apple');
    store.close();
  });

  it('rejects malformed id gracefully (returns null)', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new DeterministicEmbedder();
    const svc = new SearchService({ store, embedder });
    expect(await svc.fetchById('not-a-number')).toBeNull();
    expect(await svc.fetchById('')).toBeNull();
    expect(await svc.fetchById('-5')).toBeNull();
    expect(await svc.fetchById('1.5')).toBeNull();
    store.close();
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, loadInitialMigrations } from '../src/storage/store.js';
import { migrate } from '../src/storage/migrations.js';
import { CodeIndexer } from '../src/indexer/code/code-indexer.js';
import type { EmbeddingProvider } from '../src/core/embedding-provider.js';

class FakeEmbedder implements EmbeddingProvider {
  readonly id = 'fake';
  readonly name = 'Fake';
  readonly dims = 384;
  readonly capabilities = { batchSize: 32, offline: true };
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(this.dims);
      const seed = (t.charCodeAt(0) || 1) + t.length;
      for (let i = 0; i < this.dims; i++) v[i] = (seed % (i + 7)) / 100;
      return v;
    });
  }
  async probe() {
    return { ok: true as const, dims: this.dims };
  }
}

describe('CodeIndexer', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'opencanvas-code-test-'));
    writeFileSync(
      join(dir, 'a.ts'),
      `export function add(a: number, b: number) { return a + b; }
       export function sub(a: number, b: number) { return a - b; }`
    );
    writeFileSync(
      join(dir, 'b.ts'),
      `class Greeter {
        constructor(public name: string) {}
        greet() { return 'hi ' + this.name; }
      }`
    );
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('walks .ts files, indexes symbols and chunks', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new FakeEmbedder();

    const indexer = new CodeIndexer({ store, embedder });
    const result = await indexer.run({ rootPath: dir, sourceId: 'fixtures' });

    expect(result.indexedFiles).toBe(2);
    expect(result.symbols).toBeGreaterThanOrEqual(3); // add, sub, Greeter (greet may or may not be top-level)
    expect(result.chunks).toBeGreaterThanOrEqual(3);
    expect(result.errors).toEqual([]);

    const symbolRows = store.db
      .prepare("SELECT name, kind FROM symbols WHERE source_id = 'fixtures'")
      .all() as { name: string; kind: string }[];
    const names = symbolRows.map((r) => r.name);
    expect(names).toContain('add');
    expect(names).toContain('sub');
    expect(names).toContain('Greeter');

    const chunkRows = store.db
      .prepare("SELECT count(*) AS c FROM chunks WHERE source_id = 'fixtures'")
      .get() as { c: number };
    expect(chunkRows.c).toBeGreaterThanOrEqual(3);

    store.close();
  });

  it('is idempotent on re-run', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());
    const embedder = new FakeEmbedder();
    const indexer = new CodeIndexer({ store, embedder });

    await indexer.run({ rootPath: dir, sourceId: 'fixtures' });
    const firstChunks = (store.db.prepare("SELECT count(*) AS c FROM chunks").get() as { c: number }).c;
    const firstSymbols = (store.db.prepare("SELECT count(*) AS c FROM symbols").get() as { c: number }).c;

    await indexer.run({ rootPath: dir, sourceId: 'fixtures' });
    const secondChunks = (store.db.prepare("SELECT count(*) AS c FROM chunks").get() as { c: number }).c;
    const secondSymbols = (store.db.prepare("SELECT count(*) AS c FROM symbols").get() as { c: number }).c;

    expect(secondChunks).toBe(firstChunks);
    expect(secondSymbols).toBe(firstSymbols);
    store.close();
  });
});

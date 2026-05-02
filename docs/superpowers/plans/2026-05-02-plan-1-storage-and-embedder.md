# Plan 1 — Storage + Embedder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a SQLite-backed local store (open + migrate to the design spec's schema) and a provider-agnostic embedder with a bundled ONNX default, exposed via CLI for end-to-end validation on the user's machine.

**Architecture:** SQLite via `better-sqlite3` with `sqlite-vec` extension for vector search and FTS5 for keyword search; single-file store at `~/.llm-wiki/index.sqlite`. Embedder is an `EmbeddingProvider` interface with a `BundledOnnxEmbedder` (using `@huggingface/transformers` + `bge-small-en-v1.5`, proven viable in Spike 03) plus thin adapters for OpenAI, Voyage, and Ollama. Profile config is extended with an `embed` discriminated union, parallel to the existing `llm` field. The activation probe (already runs LLM probe per Plan 1') gains an embedder probe.

**Tech Stack:** Node.js 24+ · TypeScript · `better-sqlite3` (native bindings, prebuilt for macOS/Linux/Windows) · `sqlite-vec` (loaded as extension) · `@huggingface/transformers` + `onnxruntime-node` · `openai` (reused for OpenAI embeddings) · existing Zod, Vitest, tsx infrastructure from Plan 1' (vertical slice).

**SQL helper convention:** All raw multi-statement DDL is run via a tiny helper `runSql(db, sql)` that calls `db.exec(sql)` (a `better-sqlite3` method, NOT `child_process`). Single statements use the parameterised `db.prepare(...).run(...)` form. No shell commands are run from this code path.

**References:**
- Design spec: `docs/superpowers/specs/2026-05-02-llm-wiki-design.md` §3 (core abstractions), §4 (indexing + cache layer), §5 (embedding provider abstraction)
- Spec amendments: `docs/superpowers/specs/2026-05-02-llm-wiki-design-amendments.md` Amendment 3 (ONNX cold-start mitigation)
- Spike 03 findings: `docs/superpowers/spikes/03-onnx-bundled.md` — bundled ONNX viable, 4.5s cold-start, 272 chunks/sec, 384-dim, ~127MB on disk

**Out of scope:**
- Space-agent fork integration (Plan 1.5)
- MCP adapter and Source registry (Plan 2)
- Indexers — code, document, ticket (Plan 3)
- Cross-source link resolver (Plan 3)
- Prompt cache / result cache write paths (Plan 5 — agent loop)
- Widgets, canvas templates, agent loop (Plans 5–7)

---

## File structure

### New files

```
src/
  core/
    embedding-provider.ts        # interface + ProbeResult shared types
  storage/
    store.ts                     # openStore(path), close(), runSql helper
    migrations.ts                # migration runner
    migrations/
      001_initial.sql            # all tables from spec §4
  embedders/
    index.ts                     # createEmbedder(profile) factory
    bundled-onnx.ts              # default: bge-small-en-v1.5 via @huggingface/transformers
    openai.ts                    # text-embedding-3-small
    voyage.ts                    # voyage-3 (HTTP, no SDK needed)
    ollama.ts                    # nomic-embed-text against localhost:11434
__tests__/
  storage.test.ts                # store open, migrate, basic insert/query, sqlite-vec smoke
  embedder.test.ts               # interface contract via FakeEmbedder; ONNX integration test marked skipped
```

### Modified files

```
package.json                     # add deps: better-sqlite3, sqlite-vec, @huggingface/transformers, onnxruntime-node
src/config/schema.ts             # add `embed` discriminated union to ProfileSchema
src/config/loader.ts             # populate default embed: { provider: 'onnx-bundled' }
src/config/probe.ts              # add probeEmbedder() alongside existing probeLLM()
src/cli.ts                       # add --embed and --storage-status commands
__tests__/config.test.ts         # cover the new embed field shape and defaults
README.md                        # document new CLI commands and embedder providers
```

### Files NOT touched in this plan

`src/core/provider.ts`, `src/core/envelope.ts`, `src/providers/**`, `__tests__/provider.test.ts`, `__tests__/envelope.test.ts` — the LLM provider layer from Plan 1' is stable.

---

## Task 0: Add native dependencies and verify install

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add deps to `package.json`**

Edit `package.json` and add to `dependencies`:

```json
"better-sqlite3": "^11.0.0",
"sqlite-vec": "^0.1.6",
"@huggingface/transformers": "^4.0.0",
"onnxruntime-node": "^1.20.0"
```

And to `devDependencies`:

```json
"@types/better-sqlite3": "^7.6.0"
```

Use `*` for the version if these specific majors don't resolve cleanly; the goal is "current stable" not pinning.

- [ ] **Step 2: Install**

Run:
```bash
cd /Users/krunal/Development/llm-wiki && pnpm install
```

Expected: clean install. `better-sqlite3` and `onnxruntime-node` ship prebuilt binaries for macOS arm64 / Linux / Windows so no native build should run. If a native build attempt happens on the user's machine and fails, report BLOCKED — we have a portability bug to solve before continuing.

- [ ] **Step 3: Verify typecheck still passes**

Run:
```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add package.json pnpm-lock.yaml
git commit -m "chore: add better-sqlite3, sqlite-vec, transformers deps"
```

---

## Task 1: SQLite store — open and close

**Files:**
- Create: `src/storage/store.ts`
- Test: `__tests__/storage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/storage.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { openStore } from '../src/storage/store.js';

describe('openStore', () => {
  it('opens an in-memory database and exposes the underlying handle', async () => {
    const store = await openStore({ path: ':memory:' });
    expect(store.db).toBeDefined();
    const result = store.db.prepare('SELECT 1 AS one').get() as { one: number };
    expect(result.one).toBe(1);
    store.close();
  });

  it('throws a descriptive error when the directory does not exist', async () => {
    await expect(
      openStore({ path: '/this/directory/does/not/exist/index.sqlite' })
    ).rejects.toThrow(/does not exist/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test storage
```

Expected: FAIL with "Failed to load url ../src/storage/store.js" or "Cannot find module".

- [ ] **Step 3: Implement `openStore` and `runSql` helper**

Create `src/storage/store.ts`:

```typescript
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type Store = {
  db: Database.Database;
  close(): void;
};

export type OpenStoreOptions = {
  path: string;          // ':memory:' or absolute file path
  readonly?: boolean;
};

/**
 * Run multi-statement SQL against the store. Wraps better-sqlite3's
 * native multi-statement runner. NOT a child_process call.
 */
export function runSql(db: Database.Database, sql: string): void {
  // eslint-disable-next-line no-restricted-syntax -- better-sqlite3 API
  db.exec(sql);
}

export async function openStore(options: OpenStoreOptions): Promise<Store> {
  if (options.path !== ':memory:') {
    const dir = dirname(options.path);
    if (!existsSync(dir)) {
      throw new Error(
        `Cannot open SQLite store: directory does not exist: ${dir}`
      );
    }
  }

  const db = new Database(options.path, { readonly: options.readonly ?? false });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  sqliteVec.load(db);

  return {
    db,
    close: () => db.close(),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test storage
```

Expected: PASS, both tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/storage/store.ts __tests__/storage.test.ts
git commit -m "feat(storage): openStore with sqlite-vec extension and WAL"
```

---

## Task 2: Migration runner

**Files:**
- Create: `src/storage/migrations.ts`
- Test: `__tests__/storage.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/storage.test.ts`:

```typescript
import { migrate, getAppliedMigrations } from '../src/storage/migrations.js';

describe('migrations', () => {
  it('applies migrations idempotently and records them in schema_versions', async () => {
    const store = await openStore({ path: ':memory:' });

    await migrate(store, [
      { id: '001_test', sql: 'CREATE TABLE foo (id INTEGER PRIMARY KEY, label TEXT);' },
    ]);

    const applied = getAppliedMigrations(store);
    expect(applied).toEqual(['001_test']);

    // Idempotent: second call is a no-op
    await migrate(store, [
      { id: '001_test', sql: 'CREATE TABLE foo (id INTEGER PRIMARY KEY, label TEXT);' },
    ]);
    expect(getAppliedMigrations(store)).toEqual(['001_test']);

    store.close();
  });

  it('runs new migrations in order, skipping already-applied ones', async () => {
    const store = await openStore({ path: ':memory:' });

    await migrate(store, [
      { id: '001', sql: 'CREATE TABLE a (x INTEGER);' },
    ]);
    await migrate(store, [
      { id: '001', sql: 'CREATE TABLE a (x INTEGER);' },
      { id: '002', sql: 'CREATE TABLE b (y INTEGER);' },
    ]);

    expect(getAppliedMigrations(store)).toEqual(['001', '002']);
    store.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test storage
```

Expected: FAIL with "Cannot find module ../src/storage/migrations.js".

- [ ] **Step 3: Implement migration runner**

Create `src/storage/migrations.ts`:

```typescript
import { runSql, type Store } from './store.js';

export type Migration = {
  id: string;
  sql: string;
};

const SCHEMA_VERSIONS_DDL = `
  CREATE TABLE IF NOT EXISTS schema_versions (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )
`;

export function getAppliedMigrations(store: Store): string[] {
  runSql(store.db, SCHEMA_VERSIONS_DDL);
  const rows = store.db
    .prepare('SELECT id FROM schema_versions ORDER BY id')
    .all() as { id: string }[];
  return rows.map((r) => r.id);
}

export async function migrate(
  store: Store,
  migrations: Migration[]
): Promise<{ applied: string[]; skipped: string[] }> {
  runSql(store.db, SCHEMA_VERSIONS_DDL);

  const alreadyApplied = new Set(getAppliedMigrations(store));
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const m of migrations) {
    if (alreadyApplied.has(m.id)) {
      skipped.push(m.id);
      continue;
    }
    const tx = store.db.transaction(() => {
      runSql(store.db, m.sql);
      store.db
        .prepare('INSERT INTO schema_versions (id, applied_at) VALUES (?, ?)')
        .run(m.id, Date.now());
    });
    tx();
    applied.push(m.id);
  }

  return { applied, skipped };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test storage
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/storage/migrations.ts __tests__/storage.test.ts
git commit -m "feat(storage): migration runner with schema_versions tracking"
```

---

## Task 3: Initial schema migration

**Files:**
- Create: `src/storage/migrations/001_initial.sql`
- Modify: `src/storage/store.ts` (add `loadInitialMigrations` helper)
- Test: `__tests__/storage.test.ts`

The schema mirrors design spec §4. We create all tables but only smoke-test a subset; later plans will use the rest.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/storage.test.ts`:

```typescript
import { loadInitialMigrations } from '../src/storage/store.js';

describe('initial migration', () => {
  it('creates all tables from the spec', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());

    const tables = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','virtual')")
      .all()
      .map((row) => (row as { name: string }).name)
      .sort();

    for (const expected of [
      'chunks',
      'symbols',
      'links',
      'prompt_cache',
      'result_cache',
      'sync_state',
      'schema_versions',
    ]) {
      expect(tables).toContain(expected);
    }

    // sqlite-vec creates the embeddings virtual table; FTS5 creates fts.
    // Both register multiple shadow tables, so check by name pattern.
    expect(tables.some((t) => t === 'embeddings' || t.startsWith('embeddings_'))).toBe(true);
    expect(tables.some((t) => t === 'fts' || t.startsWith('fts_'))).toBe(true);

    store.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test storage
```

Expected: FAIL — `loadInitialMigrations` not exported.

- [ ] **Step 3: Create the migration SQL**

Create `src/storage/migrations/001_initial.sql`:

```sql
-- Spec §4 schemas. Tables are created here; populated by indexers in Plan 3+.

CREATE TABLE chunks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,
  uri          TEXT NOT NULL,
  body         TEXT NOT NULL,
  meta_json    TEXT,
  embedder_id  TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (source_id, uri)
);

CREATE INDEX idx_chunks_source ON chunks (source_id);
CREATE INDEX idx_chunks_kind ON chunks (kind);

CREATE TABLE symbols (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id    TEXT NOT NULL,
  file         TEXT NOT NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL,
  lang         TEXT NOT NULL,
  refs_json    TEXT,
  created_at   INTEGER NOT NULL
);

CREATE INDEX idx_symbols_name ON symbols (name);
CREATE INDEX idx_symbols_source ON symbols (source_id);

CREATE TABLE links (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_chunk_id   INTEGER NOT NULL,
  to_uri          TEXT NOT NULL,
  link_type       TEXT NOT NULL,
  confidence      REAL NOT NULL,
  FOREIGN KEY (from_chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

CREATE INDEX idx_links_from ON links (from_chunk_id);
CREATE INDEX idx_links_to ON links (to_uri);

CREATE TABLE prompt_cache (
  key           TEXT PRIMARY KEY,
  response      TEXT NOT NULL,
  tokens_in     INTEGER NOT NULL,
  tokens_out    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  ttl_ms        INTEGER NOT NULL,
  profile_id    TEXT NOT NULL
);

CREATE INDEX idx_prompt_cache_profile ON prompt_cache (profile_id);

CREATE TABLE result_cache (
  uri           TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  shape_json    TEXT NOT NULL,
  fetched_at    INTEGER NOT NULL,
  ttl_ms        INTEGER NOT NULL
);

CREATE TABLE sync_state (
  source_id        TEXT PRIMARY KEY,
  last_synced_at   INTEGER NOT NULL,
  cursor           TEXT
);

CREATE VIRTUAL TABLE fts USING fts5 (
  body,
  content='chunks',
  content_rowid='id'
);

CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO fts (rowid, body) VALUES (new.id, new.body);
END;

CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO fts (fts, rowid, body) VALUES ('delete', old.id, old.body);
END;

CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO fts (fts, rowid, body) VALUES ('delete', old.id, old.body);
  INSERT INTO fts (rowid, body) VALUES (new.id, new.body);
END;

-- Vector index via sqlite-vec. Dimension matches the default bundled embedder
-- (bge-small-en-v1.5 = 384). Re-creating the table at a different dim
-- requires a re-index — handled in a future migration if/when we change defaults.
CREATE VIRTUAL TABLE embeddings USING vec0 (
  chunk_id INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);
```

- [ ] **Step 4: Add `loadInitialMigrations` to `src/storage/store.ts`**

Append to `src/storage/store.ts`:

```typescript
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Migration } from './migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function loadInitialMigrations(): Promise<Migration[]> {
  const sql = await readFile(join(__dirname, 'migrations', '001_initial.sql'), 'utf8');
  return [{ id: '001_initial', sql }];
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test storage
```

Expected: PASS, all storage tests green.

- [ ] **Step 6: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/storage/store.ts src/storage/migrations/001_initial.sql __tests__/storage.test.ts
git commit -m "feat(storage): initial schema (chunks, fts, embeddings, caches)"
```

---

## Task 4: Storage smoke — chunks insert/query and vector roundtrip

**Files:**
- Test: `__tests__/storage.test.ts`

This task tests our schema by directly using `db.prepare(...)`. A typed CRUD helper layer is intentionally NOT introduced here — Plan 3 (indexers) will add helpers driven by real call patterns.

- [ ] **Step 1: Write the failing test**

Append to `__tests__/storage.test.ts`:

```typescript
describe('chunks + embeddings smoke', () => {
  it('inserts a chunk and round-trips an embedding via sqlite-vec', async () => {
    const store = await openStore({ path: ':memory:' });
    await migrate(store, await loadInitialMigrations());

    const insertChunk = store.db.prepare(
      `INSERT INTO chunks (source_id, kind, uri, body, embedder_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const result = insertChunk.run(
      'test-source',
      'text-document',
      'file:///example.md',
      'Hello world',
      'onnx-bundled-bge-small',
      Date.now()
    );
    const chunkId = Number(result.lastInsertRowid);
    expect(chunkId).toBeGreaterThan(0);

    // Sanity-check the FTS trigger fired
    const ftsHit = store.db
      .prepare(`SELECT rowid FROM fts WHERE fts MATCH 'hello'`)
      .all() as { rowid: number }[];
    expect(ftsHit.map((r) => r.rowid)).toContain(chunkId);

    // Insert a 384-dim vector. sqlite-vec accepts JSON arrays or Float32Array buffers.
    const vec = new Float32Array(384);
    for (let i = 0; i < 384; i++) vec[i] = (i % 16) / 16;
    store.db
      .prepare(`INSERT INTO embeddings (chunk_id, embedding) VALUES (?, ?)`)
      .run(chunkId, Buffer.from(vec.buffer));

    // Vector similarity query against itself
    const nearest = store.db
      .prepare(
        `SELECT chunk_id, distance
         FROM embeddings
         WHERE embedding MATCH ?
         ORDER BY distance
         LIMIT 1`
      )
      .all(Buffer.from(vec.buffer)) as { chunk_id: number; distance: number }[];

    expect(nearest).toHaveLength(1);
    expect(nearest[0].chunk_id).toBe(chunkId);
    expect(nearest[0].distance).toBeLessThan(0.001);

    store.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test storage
```

Expected: PASS. (The test exercises code that already exists; it's a smoke test for the schema, not a TDD gate.)

If `embedding MATCH` syntax fails, sqlite-vec may want JSON-array text instead of `Buffer`. Substitute `JSON.stringify(Array.from(vec))` for the parameter binding. Document the working form.

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add __tests__/storage.test.ts
git commit -m "test(storage): smoke-test chunks insert, FTS trigger, vec roundtrip"
```

---

## Task 5: EmbeddingProvider interface

**Files:**
- Create: `src/core/embedding-provider.ts`
- Test: `__tests__/embedder.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/embedder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type {
  EmbeddingProvider,
  EmbeddingProbeResult,
} from '../src/core/embedding-provider.js';

class FakeEmbedder implements EmbeddingProvider {
  readonly id = 'fake';
  readonly name = 'Fake';
  readonly dims = 4;
  readonly capabilities = { batchSize: 8, offline: true };
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(this.dims);
      for (let i = 0; i < this.dims; i++) v[i] = (t.charCodeAt(i % t.length) || 0) / 128;
      return v;
    });
  }
  async probe(): Promise<EmbeddingProbeResult> {
    return { ok: true, latencyMs: 0, dims: this.dims };
  }
}

describe('EmbeddingProvider', () => {
  it('embeds a batch and returns one vector per text', async () => {
    const e = new FakeEmbedder();
    const out = await e.embed(['hello', 'world']);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(Float32Array);
    expect(out[0].length).toBe(e.dims);
  });

  it('exposes a probe with dims surfaced', async () => {
    const e = new FakeEmbedder();
    const r = await e.probe();
    expect(r.ok).toBe(true);
    expect(r.dims).toBe(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test embedder
```

Expected: FAIL — `embedding-provider.js` not found.

- [ ] **Step 3: Implement the interface**

Create `src/core/embedding-provider.ts`:

```typescript
export type EmbeddingProbeResult = {
  ok: boolean;
  latencyMs?: number;
  dims?: number;
  error?: string;
};

export type EmbeddingCapabilities = {
  batchSize: number;
  offline: boolean;
};

export interface EmbeddingProvider {
  readonly id: string;
  readonly name: string;
  readonly dims: number;
  readonly capabilities: EmbeddingCapabilities;
  embed(texts: string[]): Promise<Float32Array[]>;
  probe(): Promise<EmbeddingProbeResult>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test embedder
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/core/embedding-provider.ts __tests__/embedder.test.ts
git commit -m "feat(core): EmbeddingProvider interface + ProbeResult"
```

---

## Task 6: Bundled ONNX embedder

**Files:**
- Create: `src/embedders/bundled-onnx.ts`
- Test: `__tests__/embedder.test.ts`

The full integration test (real model load + embed) is expensive and downloads ~130MB on first run. Mark it skipped by default; the user can run it manually with `RUN_INTEGRATION=1 pnpm test embedder`.

- [ ] **Step 1: Implement the bundled-ONNX embedder**

Create `src/embedders/bundled-onnx.ts`:

```typescript
import type {
  EmbeddingProvider,
  EmbeddingProbeResult,
} from '../core/embedding-provider.js';

type Pipeline = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array }>;

type BundledOnnxOptions = {
  /** HuggingFace model id. Default: BAAI/bge-small-en-v1.5 (384-dim). */
  model?: string;
};

export class BundledOnnxEmbedder implements EmbeddingProvider {
  readonly id: string;
  readonly name = 'Bundled ONNX';
  readonly dims = 384;
  readonly capabilities = { batchSize: 32, offline: true };

  private readonly modelId: string;
  private extractorPromise: Promise<Pipeline> | null = null;

  constructor(options: BundledOnnxOptions = {}) {
    this.modelId = options.model ?? 'BAAI/bge-small-en-v1.5';
    this.id = `onnx-bundled:${this.modelId}`;
  }

  private async getExtractor(): Promise<Pipeline> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        const transformers = await import('@huggingface/transformers');
        // Cache models locally; allow remote fetch on first run.
        transformers.env.allowRemoteModels = true;
        const extractor = await transformers.pipeline(
          'feature-extraction',
          this.modelId
        );
        return extractor as unknown as Pipeline;
      })();
    }
    return this.extractorPromise;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.getExtractor();
    const out: Float32Array[] = [];
    for (const text of texts) {
      const result = await extractor(text, { pooling: 'mean', normalize: true });
      out.push(result.data);
    }
    return out;
  }

  async probe(): Promise<EmbeddingProbeResult> {
    const t0 = performance.now();
    try {
      const v = await this.embed(['probe']);
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - t0),
        dims: v[0].length,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
```

- [ ] **Step 2: Add the integration test (skipped by default)**

Append to `__tests__/embedder.test.ts`:

```typescript
import { BundledOnnxEmbedder } from '../src/embedders/bundled-onnx.js';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const itIntegration = runIntegration ? it : it.skip;

describe('BundledOnnxEmbedder (integration)', () => {
  itIntegration(
    'loads the model and produces a 384-d normalized vector',
    async () => {
      const e = new BundledOnnxEmbedder();
      const out = await e.embed(['the quick brown fox']);
      expect(out).toHaveLength(1);
      expect(out[0].length).toBe(384);
      // Mean-pooled + normalized → unit vector
      let norm = 0;
      for (let i = 0; i < out[0].length; i++) norm += out[0][i] * out[0][i];
      expect(Math.sqrt(norm)).toBeCloseTo(1, 3);
    },
    120_000 // first run downloads the model
  );
});
```

- [ ] **Step 3: Run unit tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test embedder
```

Expected: PASS. The integration test is skipped (no `RUN_INTEGRATION=1`).

- [ ] **Step 4: Optional — run the integration test once locally**

```bash
cd /Users/krunal/Development/llm-wiki && RUN_INTEGRATION=1 pnpm test embedder
```

First run downloads ~130MB; subsequent runs are fast. If this fails on the user's machine, report DONE_WITH_CONCERNS — Plan 1 ships the implementation regardless because Spike 03 already proved viability.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/embedders/bundled-onnx.ts __tests__/embedder.test.ts
git commit -m "feat(embedders): bundled ONNX (bge-small-en-v1.5, 384-d)"
```

---

## Task 7: OpenAI, Voyage, Ollama embedder adapters

**Files:**
- Create: `src/embedders/openai.ts`
- Create: `src/embedders/voyage.ts`
- Create: `src/embedders/ollama.ts`
- Create: `src/embedders/index.ts`

These are thin HTTP/SDK adapters. We don't add per-provider unit tests beyond what the interface contract test in Task 5 already covers; live calls are validated via the `--probe` CLI command (Task 10).

- [ ] **Step 1: Implement OpenAI embedder**

Create `src/embedders/openai.ts`:

```typescript
import OpenAI from 'openai';
import type {
  EmbeddingProvider,
  EmbeddingProbeResult,
} from '../core/embedding-provider.js';

const MODEL_DIMS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
};

export type OpenAIEmbedderOptions = {
  model?: string;
  apiKey?: string;
};

export class OpenAIEmbedder implements EmbeddingProvider {
  readonly id: string;
  readonly name = 'OpenAI';
  readonly dims: number;
  readonly capabilities = { batchSize: 100, offline: false };

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIEmbedderOptions = {}) {
    this.model = options.model ?? 'text-embedding-3-small';
    this.dims = MODEL_DIMS[this.model] ?? 1536;
    this.id = `openai:${this.model}`;
    this.client = new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY });
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });
    return response.data.map((d) => Float32Array.from(d.embedding));
  }

  async probe(): Promise<EmbeddingProbeResult> {
    if (!process.env.OPENAI_API_KEY) {
      return { ok: false, error: 'OPENAI_API_KEY not set' };
    }
    const t0 = performance.now();
    try {
      const v = await this.embed(['probe']);
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - t0),
        dims: v[0].length,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
```

- [ ] **Step 2: Implement Voyage embedder**

Create `src/embedders/voyage.ts` (HTTP, no SDK):

```typescript
import type {
  EmbeddingProvider,
  EmbeddingProbeResult,
} from '../core/embedding-provider.js';

const MODEL_DIMS: Record<string, number> = {
  'voyage-3': 1024,
  'voyage-3-large': 1024,
  'voyage-code-3': 1024,
};

export type VoyageEmbedderOptions = {
  model?: string;
  apiKey?: string;
};

export class VoyageEmbedder implements EmbeddingProvider {
  readonly id: string;
  readonly name = 'Voyage';
  readonly dims: number;
  readonly capabilities = { batchSize: 128, offline: false };

  private readonly model: string;
  private readonly apiKey: string | undefined;

  constructor(options: VoyageEmbedderOptions = {}) {
    this.model = options.model ?? 'voyage-3';
    this.dims = MODEL_DIMS[this.model] ?? 1024;
    this.id = `voyage:${this.model}`;
    this.apiKey = options.apiKey ?? process.env.VOYAGE_API_KEY;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!this.apiKey) throw new Error('VOYAGE_API_KEY not set');

    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    });

    if (!response.ok) {
      throw new Error(
        `Voyage API error ${response.status}: ${await response.text()}`
      );
    }

    const json = (await response.json()) as {
      data: { embedding: number[] }[];
    };
    return json.data.map((d) => Float32Array.from(d.embedding));
  }

  async probe(): Promise<EmbeddingProbeResult> {
    if (!this.apiKey) return { ok: false, error: 'VOYAGE_API_KEY not set' };
    const t0 = performance.now();
    try {
      const v = await this.embed(['probe']);
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - t0),
        dims: v[0].length,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
```

- [ ] **Step 3: Implement Ollama embedder**

Create `src/embedders/ollama.ts`:

```typescript
import type {
  EmbeddingProvider,
  EmbeddingProbeResult,
} from '../core/embedding-provider.js';

const MODEL_DIMS: Record<string, number> = {
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
};

export type OllamaEmbedderOptions = {
  model?: string;
  baseUrl?: string;
};

export class OllamaEmbedder implements EmbeddingProvider {
  readonly id: string;
  readonly name = 'Ollama';
  readonly dims: number;
  readonly capabilities = { batchSize: 1, offline: true };

  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: OllamaEmbedderOptions = {}) {
    this.model = options.model ?? 'nomic-embed-text';
    this.dims = MODEL_DIMS[this.model] ?? 768;
    this.id = `ollama:${this.model}`;
    this.baseUrl = options.baseUrl ?? 'http://localhost:11434';
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (const text of texts) {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      if (!response.ok) {
        throw new Error(
          `Ollama API error ${response.status}: ${await response.text()}`
        );
      }
      const json = (await response.json()) as { embedding: number[] };
      out.push(Float32Array.from(json.embedding));
    }
    return out;
  }

  async probe(): Promise<EmbeddingProbeResult> {
    const t0 = performance.now();
    try {
      const v = await this.embed(['probe']);
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - t0),
        dims: v[0].length,
      };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof Error
            ? `${e.message} (is Ollama running at ${this.baseUrl}?)`
            : String(e),
      };
    }
  }
}
```

- [ ] **Step 4: Create the factory**

Create `src/embedders/index.ts`:

```typescript
import type { EmbeddingProvider } from '../core/embedding-provider.js';
import type { Profile } from '../config/schema.js';
import { BundledOnnxEmbedder } from './bundled-onnx.js';
import { OpenAIEmbedder } from './openai.js';
import { VoyageEmbedder } from './voyage.js';
import { OllamaEmbedder } from './ollama.js';

export function createEmbedder(profile: Profile): EmbeddingProvider {
  const e = profile.embed;
  switch (e.provider) {
    case 'onnx-bundled':
      return new BundledOnnxEmbedder({ model: e.model });
    case 'openai':
      return new OpenAIEmbedder({ model: e.model });
    case 'voyage':
      return new VoyageEmbedder({ model: e.model });
    case 'ollama':
      return new OllamaEmbedder({ model: e.model, baseUrl: e.baseUrl });
  }
}
```

- [ ] **Step 5: Verify typecheck (Profile.embed isn't defined yet — typecheck will fail; that's expected, we fix it in Task 8)**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: FAIL — `Profile.embed` is not yet defined. The factory file references a not-yet-existing union variant. This is the boundary between this task and the next; commit the embedder implementations now and resolve the schema in Task 8.

- [ ] **Step 6: Commit (factory file is staged but typecheck-broken until Task 8)**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/embedders/
git commit -m "feat(embedders): OpenAI, Voyage, Ollama adapters + factory

Factory references Profile.embed which is added in Task 8."
```

---

## Task 8: Extend profile schema with `embed` field

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/config/loader.ts`
- Modify: `__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

Read `__tests__/config.test.ts` first to understand the existing test shape. Then add a new `describe` block for the `embed` field. Append:

```typescript
describe('Profile.embed', () => {
  it('accepts a profile with onnx-bundled embedder', () => {
    const profile = ProfileSchema.parse({
      name: 'test',
      llm: { provider: 'claude-agent-sdk' },
      embed: { provider: 'onnx-bundled' },
    });
    expect(profile.embed.provider).toBe('onnx-bundled');
  });

  it('defaults onnx-bundled model to bge-small-en-v1.5', () => {
    const profile = ProfileSchema.parse({
      name: 'test',
      llm: { provider: 'claude-agent-sdk' },
      embed: { provider: 'onnx-bundled' },
    });
    expect((profile.embed as { model: string }).model).toBe('BAAI/bge-small-en-v1.5');
  });

  it('accepts openai, voyage, ollama variants', () => {
    for (const variant of [
      { provider: 'openai' as const, model: 'text-embedding-3-small' },
      { provider: 'voyage' as const, model: 'voyage-3' },
      { provider: 'ollama' as const, model: 'nomic-embed-text' },
    ]) {
      const p = ProfileSchema.parse({
        name: 't',
        llm: { provider: 'claude-agent-sdk' },
        embed: variant,
      });
      expect(p.embed.provider).toBe(variant.provider);
    }
  });

  it('rejects an unknown embed provider', () => {
    expect(() =>
      ProfileSchema.parse({
        name: 't',
        llm: { provider: 'claude-agent-sdk' },
        embed: { provider: 'totally-fake' },
      })
    ).toThrow();
  });

  it('defaults embed to onnx-bundled when omitted', () => {
    const p = ProfileSchema.parse({
      name: 't',
      llm: { provider: 'claude-agent-sdk' },
    });
    expect(p.embed.provider).toBe('onnx-bundled');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test config
```

Expected: FAIL — `embed` is not a known property; profiles without `embed` parse but the new defaulting test fails.

- [ ] **Step 3: Extend the Zod schema**

Open `src/config/schema.ts` and locate `ProfileSchema`. Add an `embed` field as a sibling to `llm`. Insert this BEFORE `ProfileSchema`:

```typescript
export const EmbedProviderSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('onnx-bundled'),
    model: z.string().default('BAAI/bge-small-en-v1.5'),
  }),
  z.object({
    provider: z.literal('openai'),
    model: z.string().default('text-embedding-3-small'),
  }),
  z.object({
    provider: z.literal('voyage'),
    model: z.string().default('voyage-3'),
  }),
  z.object({
    provider: z.literal('ollama'),
    model: z.string().default('nomic-embed-text'),
    baseUrl: z.string().url().default('http://localhost:11434'),
  }),
]);
```

Then add `embed: EmbedProviderSchema.default({ provider: 'onnx-bundled', model: 'BAAI/bge-small-en-v1.5' })` to `ProfileSchema`. Leave the existing `llm` union exactly as it is — only add the `embed` field.

- [ ] **Step 4: Update default config in `src/config/loader.ts`**

Locate the function that writes a default config when none exists. Update the default-profile object to include `embed`:

```typescript
{
  activeProfile: 'claude-sdk',
  profiles: [
    {
      name: 'claude-sdk',
      llm: { provider: 'claude-agent-sdk' },
      embed: { provider: 'onnx-bundled', model: 'BAAI/bge-small-en-v1.5' },
    },
  ],
}
```

- [ ] **Step 5: Run config and embedder tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test config embedder
```

Expected: PASS for both. Typecheck should also now pass:

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0. The factory in `src/embedders/index.ts` resolves cleanly now that `Profile.embed` exists.

- [ ] **Step 6: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/config/schema.ts src/config/loader.ts __tests__/config.test.ts
git commit -m "feat(config): add embed discriminated union to ProfileSchema"
```

---

## Task 9: Embedder probe in profile activation

**Files:**
- Modify: `src/config/probe.ts`
- Test: `__tests__/config.test.ts`

The existing `probe.ts` only checks the LLM. We extend it to also probe the embedder, with both run in parallel. The combined probe result should clearly indicate which subsystem (if any) failed.

- [ ] **Step 1: Read the current `probe.ts` shape**

Read `src/config/probe.ts` to see the existing function signature (likely something like `probeProfile(profile: Profile): Promise<{ llm: ... }>`).

- [ ] **Step 2: Write the failing test**

Append to `__tests__/config.test.ts`:

```typescript
import { probeProfile } from '../src/config/probe.js';

describe('probeProfile', () => {
  it('returns separate llm and embed probe results', async () => {
    const profile = ProfileSchema.parse({
      name: 't',
      llm: { provider: 'amp' }, // stub; doesn't hit network
      embed: { provider: 'voyage', model: 'voyage-3' }, // probe will fail (no key)
    });

    const result = await probeProfile(profile);
    expect(result.llm).toBeDefined();
    expect(result.embed).toBeDefined();
    expect(result.embed.ok).toBe(false);
    expect(result.embed.error).toMatch(/VOYAGE_API_KEY/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test config
```

Expected: FAIL — `result.embed` is undefined (probe doesn't yet check the embedder).

- [ ] **Step 4: Update `probe.ts`**

Edit `src/config/probe.ts`. Add the embedder probe alongside the existing LLM probe. The full updated module:

```typescript
import type { Profile } from './schema.js';
import { createProvider } from '../providers/index.js';
import { createEmbedder } from '../embedders/index.js';

export type ProbeResult = {
  ok: boolean;
  latencyMs?: number;
  dims?: number;
  error?: string;
};

export type ProfileProbeResult = {
  profile: string;
  llm: ProbeResult;
  embed: ProbeResult;
};

export async function probeProfile(profile: Profile): Promise<ProfileProbeResult> {
  const llmProvider = createProvider(profile);
  const embedProvider = createEmbedder(profile);

  const [llm, embed] = await Promise.all([llmProvider.probe(), embedProvider.probe()]);

  return { profile: profile.name, llm, embed };
}
```

The exact field names of `ProbeResult` should match what `LLMProvider.probe()` and `EmbeddingProvider.probe()` return. If the existing `LLMProvider.probe()` returns `{ ok, latencyMs?, error? }` (Plan 1' signature) and `EmbeddingProvider.probe()` returns `{ ok, latencyMs?, dims?, error? }`, the union of those fields is what `ProbeResult` exposes.

- [ ] **Step 5: Run tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test
```

Expected: all passing (storage, embedder, config, provider, envelope tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/config/probe.ts __tests__/config.test.ts
git commit -m "feat(config): probeProfile runs LLM and embed probes in parallel"
```

---

## Task 10: CLI commands — `--embed` and `--storage-status`

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Read the existing CLI structure**

Read `src/cli.ts` to see how commands are routed. Plan 1' added `--probe`, `--list-profiles`, and the default-prompt path. We add two more sibling commands.

- [ ] **Step 2: Add `--embed` and `--storage-status`**

The CLI should now support:

| Command | Behavior |
| --- | --- |
| `pnpm cli "<prompt>"` | (existing) Streams LLM response |
| `pnpm cli --probe` | (existing, extended) Now reports both LLM and embed probe |
| `pnpm cli --list-profiles` | (existing) |
| `pnpm cli --embed "<text>"` | New — embeds the text via the active profile's embedder, prints first 8 dims and total |
| `pnpm cli --storage-status` | New — opens `~/.llm-wiki/index.sqlite`, runs migrations, prints DB path, file size, table-row counts |

Edit `src/cli.ts` to add the new branches. The `--embed` branch:

```typescript
if (args.includes('--embed')) {
  const idx = args.indexOf('--embed');
  const text = args[idx + 1];
  if (!text) {
    console.error('Usage: pnpm cli --embed "<text>"');
    process.exit(1);
  }
  const { activeProfile } = await loadConfig({ profileOverride });
  const embedder = createEmbedder(activeProfile);
  const t0 = performance.now();
  const [vec] = await embedder.embed([text]);
  const ms = Math.round(performance.now() - t0);
  console.log(`embedder: ${embedder.id}`);
  console.log(`dims:     ${vec.length}`);
  console.log(`latency:  ${ms} ms`);
  const head = Array.from(vec.slice(0, 8))
    .map((n) => n.toFixed(4))
    .join(', ');
  console.log(`first 8:  [${head}, ...]`);
  return;
}
```

The `--storage-status` branch:

```typescript
if (args.includes('--storage-status')) {
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const { mkdirSync, existsSync, statSync } = await import('node:fs');
  const { openStore, loadInitialMigrations } = await import('./storage/store.js');
  const { migrate } = await import('./storage/migrations.js');

  const dir = join(homedir(), '.llm-wiki');
  const path = join(dir, 'index.sqlite');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const store = await openStore({ path });
  await migrate(store, await loadInitialMigrations());

  const size = existsSync(path) ? statSync(path).size : 0;
  const tables = store.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];

  console.log(`store:    ${path}`);
  console.log(`size:     ${(size / 1024).toFixed(1)} KB`);
  console.log('tables:');
  for (const { name } of tables) {
    const row = store.db.prepare(`SELECT count(*) as c FROM "${name}"`).get() as { c: number };
    console.log(`  - ${name.padEnd(20)} rows=${row.c}`);
  }
  store.close();
  return;
}
```

Place both branches near the existing `--probe` / `--list-profiles` branches. Imports at the top:

```typescript
import { createEmbedder } from './embedders/index.js';
```

(`createProvider`, `loadConfig`, `args`, `profileOverride` are already wired from Plan 1'.)

- [ ] **Step 3: Update `--probe` output to also show embed status**

Find the `--probe` branch. The existing form prints `[OK] Claude Agent SDK (agent) — 33ms`. Update to print one line for LLM and one for embed:

```typescript
if (args.includes('--probe')) {
  const { activeProfile } = await loadConfig({ profileOverride });
  const { probeProfile } = await import('./config/probe.js');
  const result = await probeProfile(activeProfile);
  const fmt = (label: string, r: { ok: boolean; latencyMs?: number; error?: string; dims?: number }) =>
    r.ok
      ? `[OK]   ${label} — ${r.latencyMs ?? '?'}ms${r.dims ? ` (${r.dims}-d)` : ''}`
      : `[FAIL] ${label} — ${r.error ?? 'unknown'}`;
  console.log(fmt('LLM   ', result.llm));
  console.log(fmt('Embed ', result.embed));
  return;
}
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test
```

Expected: all passing.

- [ ] **Step 5: Smoke-test the CLI manually**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm cli --storage-status
```

Expected: prints store path, size, and a list of tables (chunks, embeddings, fts, links, prompt_cache, etc.).

```bash
cd /Users/krunal/Development/llm-wiki && pnpm cli --probe
```

Expected: two-line output. LLM line shows `[OK]` (Claude Agent SDK probe). Embed line shows `[OK]` if the model is cached, or first-run download latency otherwise.

```bash
cd /Users/krunal/Development/llm-wiki && pnpm cli --embed "the quick brown fox"
```

Expected: prints embedder id, dims=384, latency, first 8 dims. First run downloads ~130MB.

- [ ] **Step 6: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/cli.ts
git commit -m "feat(cli): --embed, --storage-status; --probe shows embed status"
```

---

## Task 11: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a Storage and Embedder section**

Read the current `README.md`, then append (or insert into the appropriate place):

```markdown
## Storage

Local index lives at `~/.llm-wiki/index.sqlite` (single file, WAL mode, sqlite-vec extension loaded). Tables created from `src/storage/migrations/001_initial.sql` cover: `chunks`, `embeddings` (sqlite-vec), `fts` (FTS5), `symbols`, `links`, `prompt_cache`, `result_cache`, `sync_state`.

Inspect status:

\`\`\`bash
pnpm cli --storage-status
\`\`\`

The store is created on first invocation; subsequent runs reuse it.

## Embedders

Default: bundled ONNX (`bge-small-en-v1.5`, 384-dim). First run downloads ~130MB to the HuggingFace cache (`~/.cache/huggingface/`); subsequent runs are offline.

Available providers (set in `~/.llm-wiki/config.json` under `profiles[].embed`):

| Provider | Auth | Default model | Dims |
| --- | --- | --- | --- |
| `onnx-bundled` | none (offline) | `BAAI/bge-small-en-v1.5` | 384 |
| `openai` | `OPENAI_API_KEY` | `text-embedding-3-small` | 1536 |
| `voyage` | `VOYAGE_API_KEY` | `voyage-3` | 1024 |
| `ollama` | none (local Ollama) | `nomic-embed-text` | 768 |

Test the active embedder:

\`\`\`bash
pnpm cli --embed "the quick brown fox"
\`\`\`

Probe both LLM and embed in one command:

\`\`\`bash
pnpm cli --probe
\`\`\`

### Cold-start mitigation

The bundled ONNX embedder takes ~4.5s on first call (M-series CPU; spike 03 measurements). Per design amendment 3, future Plan 1.5 will pre-warm the embedder on app launch so users never see this latency interactively.
```

(In the actual README, replace the escaped backticks with real triple-backticks.)

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add README.md
git commit -m "docs: storage and embedders in README"
```

---

## Spec coverage check

| Spec section | Implemented in |
| --- | --- |
| §4 — `chunks`, `embeddings`, `fts`, `symbols`, `links`, `prompt_cache`, `result_cache`, `sync_state` schemas | Task 3 (`001_initial.sql`) |
| §4 — SQLite + sqlite-vec single-file storage | Tasks 1–4 |
| §4 — FTS5 with chunks-content sync triggers | Task 3 |
| §4 — `embedder_id` column on chunks for re-index detection | Task 3 |
| §5 — `EmbeddingProvider` interface | Task 5 |
| §5 — bundled ONNX as default | Task 6 |
| §5 — OpenAI / Voyage / Ollama optional adapters | Task 7 |
| §5 — profile config with `embed` discriminated union | Task 8 |
| §5 — activation probe runs LLM + embed | Task 9 |
| Amendment 3 — pre-warm on launch is mandatory | Documented in README; implemented in Plan 1.5 (space-agent integration) |

**Out of scope (deferred):**
- Pre-warm at app launch (Plan 1.5 — needs the space-agent app shell to attach to)
- Indexing pipelines populating `chunks` and `embeddings` (Plan 3)
- Cross-source link resolver populating `links` (Plan 3)
- Cache write paths into `prompt_cache` / `result_cache` (Plan 5 — agent loop)
- Embedder pre-warm in CLI (single-shot CLI invocations don't need it; long-lived process does)

All Plan 1 deliverables traced.

---

## Verification before declaring complete

- [ ] All tests pass: `pnpm test` exits 0
- [ ] Typecheck passes: `pnpm typecheck` exits 0
- [ ] `pnpm cli --storage-status` runs and lists all expected tables
- [ ] `pnpm cli --probe` shows both LLM and Embed status (Embed may show first-run download latency)
- [ ] `pnpm cli --embed "test"` returns a 384-dim vector via `onnx-bundled`
- [ ] No `node_modules`, model files (`*.onnx`), or DB files (`*.sqlite`) committed
- [ ] `git log --oneline` shows ~10–12 sensible commits since the start of Plan 1

---

*End of Plan 1.*

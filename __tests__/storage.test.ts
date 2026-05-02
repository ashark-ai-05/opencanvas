import { describe, it, expect } from 'vitest';
import { openStore, loadInitialMigrations } from '../src/storage/store.js';
import { migrate, getAppliedMigrations } from '../src/storage/migrations.js';

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

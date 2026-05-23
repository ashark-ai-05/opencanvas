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

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Migration } from './migrations.js';

export type Store = {
  db: Database.Database;
  close(): void;
};

export type OpenStoreOptions = {
  path: string;          // ':memory:' or absolute file path
  readonly?: boolean;
};

/**
 * Run multi-statement DDL against the store. Wraps better-sqlite3's
 * native multi-statement runner. NOT a child_process call.
 */
export function runSql(db: Database.Database, sql: string): void {
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function loadInitialMigrations(): Promise<Migration[]> {
  const sql001 = await readFile(join(__dirname, 'migrations', '001_initial.sql'), 'utf8');
  const sql002 = await readFile(
    join(__dirname, 'migrations', '002_qa_and_source_state.sql'),
    'utf8',
  );
  return [
    { id: '001_initial', sql: sql001 },
    { id: '002_qa_and_source_state', sql: sql002 },
  ];
}

/**
 * Opens the user-default store at `~/.opencanvas/index.sqlite`, creating
 * the directory and running migrations on first call. Override the path
 * with the `OPENCANVAS_STORE_PATH` env var (set to `:memory:` for tests).
 */
export async function openDefaultStore(): Promise<Store> {
  const override = process.env['OPENCANVAS_STORE_PATH'];
  const path =
    override ??
    (() => {
      const dir = `${homedir()}/.opencanvas`;
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      return `${dir}/index.sqlite`;
    })();

  const store = await openStore({ path });
  const { migrate } = await import('./migrations.js');
  await migrate(store, await loadInitialMigrations());
  return store;
}

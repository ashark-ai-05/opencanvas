import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

/**
 * Persistent storage for `/share/<id>` snapshots — the read-only public
 * canvases users create from a conversation. This is THE viral-loop
 * surface: every cool agent moment can become a shareable URL.
 *
 * Storage shape:
 *   id          — random UUID (unguessable; no enumeration attacks)
 *   data_json   — serialized { canvasSnapshot, messages, meta? }
 *   created_at  — epoch ms
 *   view_count  — incremented on each GET (cheap engagement signal)
 *
 * Size cap (256KB serialized) is enforced at creation. Pathological
 * inputs would blow up SQLite reads otherwise. The cap covers a
 * realistic canvas with a dozen widgets and a transcript; if anyone
 * hits it legitimately we'll know via the rate-limit telemetry.
 */
export interface ShareRecord {
  id: string;
  data: ShareData;
  createdAt: number;
  viewCount: number;
}

export interface ShareData {
  /** Tldraw canvas snapshot at the time of sharing. */
  canvasSnapshot: unknown;
  /** Conversation transcript (UIMessage[] shape from the frontend). */
  messages: unknown[];
  /** Optional metadata — title, author hint, agent fingerprint, etc. */
  meta?: Record<string, unknown>;
}

const DDL_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS shares (
     id TEXT PRIMARY KEY,
     data_json TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     view_count INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS idx_shares_created_at ON shares(created_at)`,
];

/** Cap on the serialized JSON size of a share. 256KB covers realistic
 *  canvases (a dozen widgets + a chat transcript); anything bigger is
 *  almost certainly pathological. */
export const MAX_SHARE_SIZE_BYTES = 256 * 1024;

export class ShareStore {
  constructor(private readonly db: Database.Database) {
    // Initialize schema idempotently — each statement is CREATE IF NOT
    // EXISTS so multiple constructions are safe.
    for (const ddl of DDL_STATEMENTS) {
      this.db.prepare(ddl).run();
    }
  }

  /**
   * Persist a share. Throws if the serialized payload is over the size cap.
   * Returns the generated id.
   */
  create(data: ShareData): { id: string; createdAt: number } {
    const serialized = JSON.stringify(data);
    if (serialized.length > MAX_SHARE_SIZE_BYTES) {
      throw new Error(
        `share payload too large: ${serialized.length} bytes > ${MAX_SHARE_SIZE_BYTES} cap`,
      );
    }
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        'INSERT INTO shares (id, data_json, created_at, view_count) VALUES (?, ?, ?, 0)',
      )
      .run(id, serialized, createdAt);
    return { id, createdAt };
  }

  /**
   * Look up a share by id. Returns null when missing; increments view_count
   * on hit so the creator (or a future stats page) can see engagement.
   */
  get(id: string): ShareRecord | null {
    const row = this.db
      .prepare(
        'SELECT id, data_json, created_at, view_count FROM shares WHERE id = ?',
      )
      .get(id) as
      | {
          id: string;
          data_json: string;
          created_at: number;
          view_count: number;
        }
      | undefined;
    if (!row) return null;
    // Increment view count opportunistically — failure to bump shouldn't
    // block the lookup.
    try {
      this.db
        .prepare('UPDATE shares SET view_count = view_count + 1 WHERE id = ?')
        .run(id);
    } catch {
      /* ignore */
    }
    let data: ShareData;
    try {
      data = JSON.parse(row.data_json) as ShareData;
    } catch (e) {
      throw new Error(
        `share ${id} has corrupt data_json: ${e instanceof Error ? e.message : e}`,
      );
    }
    return {
      id: row.id,
      data,
      createdAt: row.created_at,
      // Return the value AFTER increment so the response reflects this hit.
      viewCount: row.view_count + 1,
    };
  }
}

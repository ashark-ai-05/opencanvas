import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type Task = {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null;  // ISO 'YYYY-MM-DD' or null — camelCase in JSON
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

type TaskRow = {
  id: string;
  title: string;
  done: number;
  due_date: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

type NoteRow = {
  id: number;
  body: string;
  updated_at: number;
};

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS notebook_notes (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  body TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notebook_tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  due_date TEXT NULL,
  notes TEXT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notebook_tasks_due_date ON notebook_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_notebook_tasks_done_due ON notebook_tasks(done, due_date);
`;

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    done: row.done === 1,
    dueDate: row.due_date,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class NotebookStore {
  constructor(private readonly db: Database.Database) {
    // Initialize schema idempotently on construction so tables always
    // exist before any method is called. IF NOT EXISTS guards make this safe.
    db.exec(SCHEMA_DDL);
  }

  getNote(): { body: string; updatedAt: number } {
    const row = this.db
      .prepare('SELECT body, updated_at FROM notebook_notes WHERE id = 1')
      .get() as NoteRow | undefined;
    if (!row) {
      return { body: '', updatedAt: 0 };
    }
    return { body: row.body, updatedAt: row.updated_at };
  }

  saveNote(body: string): { body: string; updatedAt: number } {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT OR REPLACE INTO notebook_notes (id, body, updated_at) VALUES (1, ?, ?)',
      )
      .run(body, now);
    return { body, updatedAt: now };
  }

  listTasks(): Task[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM notebook_tasks
         ORDER BY
           CASE WHEN due_date IS NULL THEN 1 ELSE 0 END ASC,
           due_date ASC,
           created_at DESC`,
      )
      .all() as TaskRow[];
    return rows.map(rowToTask);
  }

  listTasksByMonth(ym: string): Task[] {
    // ym = 'YYYY-MM'. Compute first and last day of that month.
    const [yearStr, monthStr] = ym.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const first = `${ym}-01`;
    // new Date(year, month, 0) gives the last day of (month-1) with 1-based month arg.
    // e.g. new Date(2026, 5, 0) = April 30... wrong. Use new Date(year, month, 0):
    // month here is already 1-based (e.g. 5 for May). new Date(2026, 5, 0) = last day of month 4 (April).
    // Correct: new Date(year, month, 0) where month is the NEXT month (0-indexed).
    // So for May (month=5), we want last day of May = new Date(2026, 5, 0)... 
    // Actually: new Date(year, m, 0) = last day of month (m-1) in 0-based OR last day of month m in 1-based.
    // Let's be explicit: Date(year, monthIndex, 0) where monthIndex is 0-based next month.
    // May = monthIndex 4. Next = 5. new Date(2026, 5, 0) = May 31, 2026. Correct.
    const lastDate = new Date(year, month, 0); // month is 1-based from split; this is correct
    const lastDay = lastDate.getDate().toString().padStart(2, '0');
    const last = `${ym}-${lastDay}`;

    const rows = this.db
      .prepare(
        `SELECT * FROM notebook_tasks
         WHERE due_date >= ? AND due_date <= ?
         ORDER BY
           CASE WHEN due_date IS NULL THEN 1 ELSE 0 END ASC,
           due_date ASC,
           created_at DESC`,
      )
      .all(first, last) as TaskRow[];
    return rows.map(rowToTask);
  }

  createTask(input: {
    title: string;
    dueDate?: string | null;
    notes?: string | null;
  }): Task {
    const id = randomUUID();
    const now = Date.now();
    const dueDate = input.dueDate ?? null;
    const notes = input.notes ?? null;

    this.db
      .prepare(
        `INSERT INTO notebook_tasks (id, title, done, due_date, notes, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(id, input.title, dueDate, notes, now, now);

    return {
      id,
      title: input.title,
      done: false,
      dueDate,
      notes,
      createdAt: now,
      updatedAt: now,
    };
  }

  updateTask(
    id: string,
    patch: Partial<Pick<Task, 'title' | 'done' | 'dueDate' | 'notes'>>,
  ): Task | null {
    const existing = this.db
      .prepare('SELECT * FROM notebook_tasks WHERE id = ?')
      .get(id) as TaskRow | undefined;

    if (!existing) return null;

    const now = Date.now();
    const title = patch.title !== undefined ? patch.title : existing.title;
    const done =
      patch.done !== undefined
        ? patch.done
          ? 1
          : 0
        : existing.done;
    const dueDate =
      patch.dueDate !== undefined ? patch.dueDate : existing.due_date;
    const notes =
      patch.notes !== undefined ? patch.notes : existing.notes;

    this.db
      .prepare(
        `UPDATE notebook_tasks
         SET title = ?, done = ?, due_date = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(title, done, dueDate, notes, now, id);

    return {
      id,
      title,
      done: done === 1,
      dueDate,
      notes,
      createdAt: existing.created_at,
      updatedAt: now,
    };
  }

  deleteTask(id: string): boolean {
    const info = this.db
      .prepare('DELETE FROM notebook_tasks WHERE id = ?')
      .run(id);
    return info.changes > 0;
  }
}

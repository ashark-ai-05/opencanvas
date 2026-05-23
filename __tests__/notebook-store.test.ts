import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { NotebookStore } from '../src/backend/notebook-store.js';

function makeStore(): NotebookStore {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // sqlite-vec is loaded by the production openStore(); load it here too
  // so the in-memory DB is consistent. NotebookStore doesn't use vec, but
  // this ensures the env matches and there are no symbol conflicts.
  try { sqliteVec.load(db); } catch { /* ignore if unavailable in test env */ }
  return new NotebookStore(db);
}

describe('NotebookStore — notes', () => {
  let store: NotebookStore;

  beforeEach(() => {
    store = makeStore();
  });

  it('getNote() returns empty body and updatedAt=0 when no note exists', () => {
    const note = store.getNote();
    expect(note.body).toBe('');
    expect(note.updatedAt).toBe(0);
  });

  it('saveNote() persists body and getNote() returns it with a positive updatedAt', () => {
    const before = Date.now();
    const saved = store.saveNote('Hello notebook');
    const after = Date.now();

    expect(saved.body).toBe('Hello notebook');
    expect(saved.updatedAt).toBeGreaterThanOrEqual(before);
    expect(saved.updatedAt).toBeLessThanOrEqual(after);

    const fetched = store.getNote();
    expect(fetched.body).toBe('Hello notebook');
    expect(fetched.updatedAt).toBe(saved.updatedAt);
  });

  it('saveNote() overwrites an existing note (singleton upsert)', () => {
    store.saveNote('first');
    store.saveNote('second');
    expect(store.getNote().body).toBe('second');
  });
});

describe('NotebookStore — tasks', () => {
  let store: NotebookStore;

  beforeEach(() => {
    store = makeStore();
  });

  it('createTask() returns a Task with generated id and timestamps', () => {
    const before = Date.now();
    const task = store.createTask({ title: 'Buy milk' });
    const after = Date.now();

    expect(task.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(task.title).toBe('Buy milk');
    expect(task.done).toBe(false);
    expect(task.dueDate).toBeNull();
    expect(task.notes).toBeNull();
    expect(task.createdAt).toBeGreaterThanOrEqual(before);
    expect(task.createdAt).toBeLessThanOrEqual(after);
    expect(task.updatedAt).toBe(task.createdAt);
  });

  it('listTasks() orders by dueDate ASC NULLS LAST, then createdAt DESC', async () => {
    // Create tasks with specific due dates; use small delays to ensure distinct createdAt
    const t1 = store.createTask({ title: 'No due date A' });
    await new Promise((r) => setTimeout(r, 2));
    const t2 = store.createTask({ title: 'No due date B' });
    await new Promise((r) => setTimeout(r, 2));
    const t3 = store.createTask({ title: 'May 2026', dueDate: '2026-05-15' });
    await new Promise((r) => setTimeout(r, 2));
    const t4 = store.createTask({ title: 'April 2026', dueDate: '2026-04-01' });

    const tasks = store.listTasks();
    const ids = tasks.map((t) => t.id);

    // April before May (earlier due date), then nulls last (t2 before t1 by createdAt DESC)
    expect(ids.indexOf(t4.id)).toBeLessThan(ids.indexOf(t3.id));   // April < May
    expect(ids.indexOf(t3.id)).toBeLessThan(ids.indexOf(t2.id));   // dated < undated
    expect(ids.indexOf(t2.id)).toBeLessThan(ids.indexOf(t1.id));   // B created later → first among nulls
  });

  it('listTasksByMonth() filters to the given month only', async () => {
    const april = store.createTask({ title: 'April task', dueDate: '2026-04-15' });
    const may1 = store.createTask({ title: 'May start', dueDate: '2026-05-01' });
    const may31 = store.createTask({ title: 'May end', dueDate: '2026-05-31' });
    const june = store.createTask({ title: 'June task', dueDate: '2026-06-01' });
    const noduedate = store.createTask({ title: 'No due date' });

    const mayTasks = store.listTasksByMonth('2026-05');
    const mayIds = mayTasks.map((t) => t.id);

    expect(mayIds).toContain(may1.id);
    expect(mayIds).toContain(may31.id);
    expect(mayIds).not.toContain(april.id);
    expect(mayIds).not.toContain(june.id);
    expect(mayIds).not.toContain(noduedate.id);
  });

  it('listTasksByMonth() handles a month with 28 days (Feb 2026)', () => {
    const feb28 = store.createTask({ title: 'Feb 28', dueDate: '2026-02-28' });
    const mar01 = store.createTask({ title: 'Mar 01', dueDate: '2026-03-01' });

    const febTasks = store.listTasksByMonth('2026-02');
    const ids = febTasks.map((t) => t.id);
    expect(ids).toContain(feb28.id);
    expect(ids).not.toContain(mar01.id);
  });

  it('updateTask() flips done and bumps updatedAt', async () => {
    const task = store.createTask({ title: 'Do laundry' });
    await new Promise((r) => setTimeout(r, 2));

    const updated = store.updateTask(task.id, { done: true });
    expect(updated).not.toBeNull();
    expect(updated!.done).toBe(true);
    expect(updated!.updatedAt).toBeGreaterThan(task.updatedAt);
    expect(updated!.createdAt).toBe(task.createdAt);
  });

  it('updateTask() with a non-existent id returns null', () => {
    const result = store.updateTask('00000000-0000-4000-8000-000000000000', {
      done: true,
    });
    expect(result).toBeNull();
  });

  it('deleteTask() returns true then false on second call', () => {
    const task = store.createTask({ title: 'Ephemeral task' });
    expect(store.deleteTask(task.id)).toBe(true);
    expect(store.deleteTask(task.id)).toBe(false);
    expect(store.listTasks()).toHaveLength(0);
  });

  it('dueDate round-trips correctly for null and ISO date string', () => {
    const withDate = store.createTask({ title: 'Has date', dueDate: '2026-07-04' });
    const withNull = store.createTask({ title: 'No date', dueDate: null });

    expect(withDate.dueDate).toBe('2026-07-04');
    expect(withNull.dueDate).toBeNull();

    // Verify via listTasks round-trip
    const tasks = store.listTasks();
    const fetched = tasks.find((t) => t.id === withDate.id)!;
    const fetchedNull = tasks.find((t) => t.id === withNull.id)!;
    expect(fetched.dueDate).toBe('2026-07-04');
    expect(fetchedNull.dueDate).toBeNull();
  });

  it('updateTask() can set dueDate to null and back to a string', () => {
    const task = store.createTask({ title: 'Shifting date', dueDate: '2026-06-01' });

    const cleared = store.updateTask(task.id, { dueDate: null });
    expect(cleared!.dueDate).toBeNull();

    const restored = store.updateTask(task.id, { dueDate: '2026-06-15' });
    expect(restored!.dueDate).toBe('2026-06-15');
  });
});

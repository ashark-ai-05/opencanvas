import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { NotebookStore } from '../src/backend/notebook-store.js';
import { addTaskTool } from '../src/agent/tools/add-task.js';
import { completeTaskTool } from '../src/agent/tools/complete-task.js';
import { readNotesTool } from '../src/agent/tools/read-notes.js';
import { appendToNotesTool } from '../src/agent/tools/append-to-notes.js';

function makeStore(): NotebookStore {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  try { sqliteVec.load(db); } catch { /* ignore if unavailable */ }
  return new NotebookStore(db);
}

describe('notebook agent tools', () => {
  let store: NotebookStore;
  let getStore: () => Promise<NotebookStore>;

  beforeEach(() => {
    store = makeStore();
    getStore = async () => store;
  });

  // ── add_task ────────────────────────────────────────────────────────────────

  it('add_task creates a task and returns it with ok:true', async () => {
    const t = addTaskTool(getStore);
    const result = await t.handler({ title: 'review Q3' }, undefined);
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
    expect(data.task.title).toBe('review Q3');
    expect(data.task.done).toBe(false);
    expect(data.task.dueDate).toBeNull();
    expect(store.listTasks()).toHaveLength(1);
  });

  it('add_task stores due_date and notes', async () => {
    const t = addTaskTool(getStore);
    const result = await t.handler(
      { title: 'review Q3', due_date: '2026-05-15', notes: 'urgent' },
      undefined,
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
    expect(data.task.dueDate).toBe('2026-05-15');
    expect(data.task.notes).toBe('urgent');
  });

  it('add_task returns an id that persists in listTasks', async () => {
    const t = addTaskTool(getStore);
    const result = await t.handler({ title: 'persistent' }, undefined);
    const data = JSON.parse(result.content[0].text);
    const tasks = store.listTasks();
    expect(tasks[0].id).toBe(data.task.id);
  });

  // ── complete_task ────────────────────────────────────────────────────────────

  it('complete_task marks a task done by id', async () => {
    const created = store.createTask({ title: 'finish report' });
    const t = completeTaskTool(getStore);
    const result = await t.handler({ id: created.id }, undefined);
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
    expect(data.task.done).toBe(true);
    expect(data.task.id).toBe(created.id);
  });

  it('complete_task returns isError for unknown id', async () => {
    const t = completeTaskTool(getStore);
    const result = await t.handler({ id: 'nonexistent-id' }, undefined);
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(false);
    expect(data.error).toContain('nonexistent-id');
  });

  it('complete_task reflects done=true in subsequent listTasks', async () => {
    const created = store.createTask({ title: 'deploy' });
    const t = completeTaskTool(getStore);
    await t.handler({ id: created.id }, undefined);
    const tasks = store.listTasks();
    expect(tasks.find((task) => task.id === created.id)?.done).toBe(true);
  });

  // ── read_notes ───────────────────────────────────────────────────────────────

  it('read_notes returns the current note body', async () => {
    store.saveNote('# My notes\n\nsome content');
    const t = readNotesTool(getStore);
    const result = await t.handler({}, undefined);
    const data = JSON.parse(result.content[0].text);
    expect(data.body).toBe('# My notes\n\nsome content');
    expect(typeof data.updated_at).toBe('number');
    expect(data.updated_at).toBeGreaterThan(0);
  });

  it('read_notes returns "(notepad is empty)" string when blank', async () => {
    const t = readNotesTool(getStore);
    const result = await t.handler({}, undefined);
    expect(result.content[0].text).toContain('empty');
    // Should NOT be valid JSON — just the plain signal string
    expect(() => JSON.parse(result.content[0].text)).toThrow();
  });

  it('read_notes reflects a freshly-saved note', async () => {
    const t = readNotesTool(getStore);
    store.saveNote('hello world');
    const result = await t.handler({}, undefined);
    const data = JSON.parse(result.content[0].text);
    expect(data.body).toBe('hello world');
  });

  // ── append_to_notes ──────────────────────────────────────────────────────────

  it('append_to_notes appends with default double-newline separator', async () => {
    store.saveNote('First paragraph.');
    const t = appendToNotesTool(getStore);
    await t.handler({ text: 'Second paragraph.' }, undefined);
    expect(store.getNote().body).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('append_to_notes respects a custom separator', async () => {
    store.saveNote('A');
    const t = appendToNotesTool(getStore);
    await t.handler({ text: 'B', separator: ' | ' }, undefined);
    expect(store.getNote().body).toBe('A | B');
  });

  it('append_to_notes on empty notepad writes text without leading separator', async () => {
    const t = appendToNotesTool(getStore);
    await t.handler({ text: 'First entry.' }, undefined);
    expect(store.getNote().body).toBe('First entry.');
  });

  it('append_to_notes returns ok:true with the new body', async () => {
    store.saveNote('Existing.');
    const t = appendToNotesTool(getStore);
    const result = await t.handler({ text: 'Appended.' }, undefined);
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
    expect(data.body).toBe('Existing.\n\nAppended.');
    expect(typeof data.updated_at).toBe('number');
  });

  it('append_to_notes accumulates across multiple calls', async () => {
    const t = appendToNotesTool(getStore);
    await t.handler({ text: 'One.' }, undefined);
    await t.handler({ text: 'Two.' }, undefined);
    await t.handler({ text: 'Three.' }, undefined);
    expect(store.getNote().body).toBe('One.\n\nTwo.\n\nThree.');
  });
});

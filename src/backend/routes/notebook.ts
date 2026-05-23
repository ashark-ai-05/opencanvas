import { Hono } from 'hono';
import type { BackendState } from '../state.js';

/**
 * Notebook routes — singleton notepad + task CRUD.
 *
 *   GET    /v1/notepad              → { body, updatedAt }
 *   PUT    /v1/notepad              → { body, updatedAt }
 *   GET    /v1/tasks                → { tasks: Task[] }
 *   GET    /v1/tasks/by-month?ym=   → { tasks: Task[] }
 *   POST   /v1/tasks                → Task (201)
 *   PATCH  /v1/tasks/:id            → Task
 *   DELETE /v1/tasks/:id            → { ok: true }
 */
export function notebookRoute(state: BackendState): Hono {
  const r = new Hono();

  // GET /v1/notepad
  r.get('/v1/notepad', async (c) => {
    const store = await state.getNotebookStore();
    return c.json(store.getNote());
  });

  // PUT /v1/notepad
  r.put('/v1/notepad', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { body?: unknown };
    if (typeof body.body !== 'string') {
      return c.json({ error: 'body (string) is required' }, 400);
    }
    const store = await state.getNotebookStore();
    return c.json(store.saveNote(body.body));
  });

  // GET /v1/tasks
  r.get('/v1/tasks', async (c) => {
    const store = await state.getNotebookStore();
    return c.json({ tasks: store.listTasks() });
  });

  // GET /v1/tasks/by-month?ym=YYYY-MM
  r.get('/v1/tasks/by-month', async (c) => {
    const ym = c.req.query('ym');
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
      return c.json({ error: 'ym query param required (YYYY-MM format)' }, 400);
    }
    const store = await state.getNotebookStore();
    return c.json({ tasks: store.listTasksByMonth(ym) });
  });

  // POST /v1/tasks
  r.post('/v1/tasks', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      title?: unknown;
      due_date?: unknown;
      dueDate?: unknown;
      notes?: unknown;
    };
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return c.json({ error: 'title (non-empty string) is required' }, 400);
    }
    // Accept both camelCase and snake_case for due_date
    const rawDueDate = body.dueDate ?? body.due_date ?? null;
    if (rawDueDate !== null && typeof rawDueDate !== 'string') {
      return c.json({ error: 'dueDate must be a string (YYYY-MM-DD) or null' }, 400);
    }
    const rawNotes = body.notes ?? null;
    if (rawNotes !== null && typeof rawNotes !== 'string') {
      return c.json({ error: 'notes must be a string or null' }, 400);
    }
    const store = await state.getNotebookStore();
    const task = store.createTask({
      title: body.title,
      dueDate: rawDueDate as string | null,
      notes: rawNotes as string | null,
    });
    return c.json(task, 201);
  });

  // PATCH /v1/tasks/:id
  r.patch('/v1/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      title?: unknown;
      done?: unknown;
      due_date?: unknown;
      dueDate?: unknown;
      notes?: unknown;
    };

    const patch: Record<string, unknown> = {};
    if (body.title !== undefined) {
      if (typeof body.title !== 'string') {
        return c.json({ error: 'title must be a string' }, 400);
      }
      patch['title'] = body.title;
    }
    if (body.done !== undefined) {
      if (typeof body.done !== 'boolean') {
        return c.json({ error: 'done must be a boolean' }, 400);
      }
      patch['done'] = body.done;
    }
    // Accept both camelCase and snake_case
    const rawDueDate = body.dueDate !== undefined ? body.dueDate : body.due_date;
    if (rawDueDate !== undefined) {
      if (rawDueDate !== null && typeof rawDueDate !== 'string') {
        return c.json({ error: 'dueDate must be a string or null' }, 400);
      }
      patch['dueDate'] = rawDueDate as string | null;
    }
    if (body.notes !== undefined) {
      if (body.notes !== null && typeof body.notes !== 'string') {
        return c.json({ error: 'notes must be a string or null' }, 400);
      }
      patch['notes'] = body.notes as string | null;
    }

    const store = await state.getNotebookStore();
    const updated = store.updateTask(id, patch as Parameters<typeof store.updateTask>[1]);
    if (!updated) return c.json({ error: 'Task not found' }, 404);
    return c.json(updated);
  });

  // DELETE /v1/tasks/:id
  r.delete('/v1/tasks/:id', async (c) => {
    const id = c.req.param('id');
    const store = await state.getNotebookStore();
    const removed = store.deleteTask(id);
    if (!removed) return c.json({ error: 'Task not found' }, 404);
    return c.json({ ok: true });
  });

  return r;
}

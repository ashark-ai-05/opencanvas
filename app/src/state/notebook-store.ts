import { create } from 'zustand';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Task = {
  id: string;
  title: string;
  done: boolean;
  dueDate: string | null; // 'YYYY-MM-DD' or null
  notes: string | null;
  createdAt: number;
  updatedAt: number;
};

type Store = {
  note: { body: string; updatedAt: number } | null;
  tasks: Task[];
  tasksByMonth: Record<string, Task[]>;
  loading: boolean;
  error: string | null;
  fetchNote: () => Promise<void>;
  saveNote: (body: string) => Promise<void>;
  fetchTasks: () => Promise<void>;
  fetchTasksByMonth: (ym: string) => Promise<void>;
  createTask: (input: {
    title: string;
    dueDate?: string | null;
    notes?: string | null;
  }) => Promise<Task | null>;
  updateTask: (
    id: string,
    patch: Partial<Pick<Task, 'title' | 'done' | 'dueDate' | 'notes'>>,
  ) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<T | null> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `Server responded ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useNotebookStore = create<Store>((set, get) => ({
  note: null,
  tasks: [],
  tasksByMonth: {},
  loading: false,
  error: null,

  // ── Notepad ──────────────────────────────────────────────────────────────

  fetchNote: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiFetch<{ body: string; updatedAt: number }>(
        '/v1/notepad',
      );
      if (data) set({ note: data });
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Failed to load notepad';
      set({ error: msg });
      toast.error(msg);
    } finally {
      set({ loading: false });
    }
  },

  saveNote: async (body: string) => {
    try {
      const data = await apiFetch<{ body: string; updatedAt: number }>(
        '/v1/notepad',
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      );
      if (data) set({ note: data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save note';
      set({ error: msg });
      toast.error(msg);
    }
  },

  // ── Tasks ─────────────────────────────────────────────────────────────────

  fetchTasks: async () => {
    set({ loading: true, error: null });
    try {
      const data = await apiFetch<{ tasks: Task[] }>('/v1/tasks');
      if (data) set({ tasks: data.tasks });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load tasks';
      set({ error: msg });
      toast.error(msg);
    } finally {
      set({ loading: false });
    }
  },

  fetchTasksByMonth: async (ym: string) => {
    try {
      const data = await apiFetch<{ tasks: Task[] }>(
        `/v1/tasks/by-month?ym=${encodeURIComponent(ym)}`,
      );
      if (data) {
        set((s) => ({
          tasksByMonth: { ...s.tasksByMonth, [ym]: data.tasks },
        }));
      }
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Failed to load calendar tasks';
      toast.error(msg);
    }
  },

  createTask: async (input) => {
    try {
      const data = await apiFetch<Task>('/v1/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (data) {
        // Refetch to get server-sorted order; also refresh relevant month cache
        await get().fetchTasks();
        if (data.dueDate) {
          const ym = data.dueDate.slice(0, 7);
          await get().fetchTasksByMonth(ym);
        }
        return data;
      }
      return null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to create task';
      toast.error(msg);
      return null;
    }
  },

  updateTask: async (id: string, patch) => {
    // Optimistically update local state first
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t,
      ),
      // Also update any month cache entries
      tasksByMonth: Object.fromEntries(
        Object.entries(s.tasksByMonth).map(([ym, tasks]) => [
          ym,
          tasks.map((t) =>
            t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t,
          ),
        ]),
      ),
    }));

    try {
      await apiFetch<Task>(`/v1/tasks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to update task';
      toast.error(msg);
      // Roll back: refetch to restore server state
      await get().fetchTasks();
    }
  },

  deleteTask: async (id: string) => {
    // Optimistic removal
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      tasksByMonth: Object.fromEntries(
        Object.entries(s.tasksByMonth).map(([ym, tasks]) => [
          ym,
          tasks.filter((t) => t.id !== id),
        ]),
      ),
    }));

    try {
      await apiFetch<{ ok: boolean }>(
        `/v1/tasks/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to delete task';
      toast.error(msg);
      // Roll back
      await get().fetchTasks();
    }
  },
}));

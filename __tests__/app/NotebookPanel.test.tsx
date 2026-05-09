import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotebookPanel } from '../../app/src/components/NotebookPanel';
import { useNotebookStore } from '../../app/src/state/notebook-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_NOTE = { body: '# Hello\n\nSome notes.', updatedAt: 1000 };

const MOCK_TASKS = [
  {
    id: 'task-1',
    title: 'Buy groceries',
    done: false,
    dueDate: '2026-05-10',
    notes: null,
    createdAt: 1000,
    updatedAt: 1000,
  },
  {
    id: 'task-2',
    title: 'Call dentist',
    done: true,
    dueDate: null,
    notes: null,
    createdAt: 900,
    updatedAt: 900,
  },
];

function makeFetch() {
  return vi.fn().mockImplementation((url: unknown) => {
    const u = typeof url === 'string' ? url : '';

    if (u === '/v1/notepad' && !u.includes('PUT')) {
      return Promise.resolve({
        ok: true,
        json: async () => MOCK_NOTE,
      } as Response);
    }
    if (u.startsWith('/v1/tasks/by-month')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          tasks: [
            {
              id: 'task-cal',
              title: 'Calendar task',
              done: false,
              dueDate: '2026-05-10',
              notes: null,
              createdAt: 500,
              updatedAt: 500,
            },
          ],
        }),
      } as Response);
    }
    if (u === '/v1/tasks') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ tasks: MOCK_TASKS }),
      } as Response);
    }
    // POST /v1/tasks
    if (u === '/v1/tasks') {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          id: 'new-task',
          title: 'New task',
          done: false,
          dueDate: null,
          notes: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      } as Response);
    }
    // PATCH /v1/tasks/:id
    if (u.startsWith('/v1/tasks/')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...MOCK_TASKS[0], done: true }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Reset store to initial state
  useNotebookStore.setState({
    note: null,
    tasks: [],
    tasksByMonth: {},
    loading: false,
    error: null,
  });

  // #root for DepthPanel inert focus-trap
  const rootEl = document.createElement('div');
  rootEl.id = 'root';
  document.body.appendChild(rootEl);

  globalThis.fetch = makeFetch();
});

afterEach(() => {
  document.getElementById('root')?.remove();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('<NotebookPanel>', () => {
  it('1. mounts and shows all three tab buttons', () => {
    render(<NotebookPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /notes/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /tasks/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /calendar/i })).toBeInTheDocument();
  });

  it('2. initial tab is Notes; switching to Tasks shows task list', async () => {
    const user = userEvent.setup();

    // Pre-populate tasks so they show immediately
    useNotebookStore.setState({ tasks: MOCK_TASKS });

    render(<NotebookPanel open onClose={vi.fn()} />);

    // Notes tab is active by default — textarea is visible
    expect(
      screen.getByRole('textbox', { name: /markdown notes editor/i }),
    ).toBeInTheDocument();

    // Switch to Tasks
    await user.click(screen.getByRole('tab', { name: /tasks/i }));

    // Task titles visible
    await waitFor(() => {
      expect(screen.getByText('Buy groceries')).toBeInTheDocument();
      expect(screen.getByText('Call dentist')).toBeInTheDocument();
    });
  });

  it('3. submitting a new task calls POST /v1/tasks', async () => {
    const user = userEvent.setup();
    useNotebookStore.setState({ tasks: [] });

    render(<NotebookPanel open onClose={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: /tasks/i }));

    const titleInput = await screen.findByRole('textbox', { name: /task title/i });
    await user.type(titleInput, 'My new task');

    const addBtn = screen.getByRole('button', { name: /add task/i });
    await user.click(addBtn);

    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const postCall = calls.find(
        (args) => args[0] === '/v1/tasks' && (args[1] as RequestInit)?.method === 'POST',
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall![1] as RequestInit).body as string) as { title: string };
      expect(body.title).toBe('My new task');
    });
  });

  it('4. toggling a task checkbox PATCHes done', async () => {
    const user = userEvent.setup();
    useNotebookStore.setState({ tasks: MOCK_TASKS });

    render(<NotebookPanel open onClose={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: /tasks/i }));

    const checkbox = await screen.findByRole('checkbox', {
      name: /mark "buy groceries"/i,
    });
    await user.click(checkbox);

    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const patchCall = calls.find(
        (args) =>
          typeof args[0] === 'string' &&
          args[0].startsWith('/v1/tasks/') &&
          (args[1] as RequestInit)?.method === 'PATCH',
      );
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string) as { done: boolean };
      expect(body.done).toBe(true);
    });
  });

  it('5. switching to Calendar fetches the by-month route', async () => {
    const user = userEvent.setup();
    render(<NotebookPanel open onClose={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: /calendar/i }));

    await waitFor(() => {
      const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const monthCall = calls.find((args) =>
        typeof args[0] === 'string' && args[0].includes('/v1/tasks/by-month'),
      );
      expect(monthCall).toBeDefined();
    });
  });

  it('6. clicking a calendar day with tasks switches to Tasks tab with filter applied', async () => {
    const user = userEvent.setup();

    // Pre-seed the month cache so the day cell renders immediately
    useNotebookStore.setState({
      tasksByMonth: {
        '2026-05': [
          {
            id: 'task-cal',
            title: 'Calendar task',
            done: false,
            dueDate: '2026-05-10',
            notes: null,
            createdAt: 500,
            updatedAt: 500,
          },
        ],
      },
    });

    render(<NotebookPanel open onClose={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: /calendar/i }));

    // Find and click the day cell with tasks (aria-label includes the date)
    const dayCell = await screen.findByRole('button', {
      name: /2026-05-10.*task/i,
    });
    await user.click(dayCell);

    // Should switch to Tasks tab with filter pill showing
    await waitFor(() => {
      expect(screen.getByText(/showing tasks for 2026-05-10/i)).toBeInTheDocument();
    });
  });

  it('7a. Notes empty state — textarea shows placeholder', () => {
    render(<NotebookPanel open onClose={vi.fn()} />);
    const textarea = screen.getByRole('textbox', { name: /markdown notes editor/i });
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveAttribute('placeholder');
  });

  it('7b. Tasks empty state shows "No tasks." message', async () => {
    const user = userEvent.setup();
    useNotebookStore.setState({ tasks: [] });

    // Override fetch so that /v1/tasks returns an empty list
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tasks: [] }),
    } as Response);

    render(<NotebookPanel open onClose={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: /tasks/i }));

    await waitFor(() => {
      expect(screen.getByText(/no tasks\./i)).toBeInTheDocument();
    });
  });

  it('7c. Calendar empty month shows grid with no task dots', async () => {
    const user = userEvent.setup();
    useNotebookStore.setState({ tasksByMonth: {} });

    // Override fetch to return empty tasks for by-month
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tasks: [] }),
    } as Response);

    render(<NotebookPanel open onClose={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: /calendar/i }));

    // Month/year heading should render
    await waitFor(() => {
      // Sun Mon Tue Wed Thu Fri Sat header should be present
      expect(screen.getByText('Sun')).toBeInTheDocument();
      expect(screen.getByText('Mon')).toBeInTheDocument();
    });
  });

  it('close button calls onClose', async () => {
    const onClose = vi.fn();
    render(<NotebookPanel open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /close notebook/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SchedulesPanel } from '../../app/src/components/SchedulesPanel';
import { useConversationsStore } from '../../app/src/state/conversations-store';

const mockConversation = {
  id: 'conv-1',
  title: 'My conversation',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messages: [],
};

beforeEach(() => {
  // Seed at least one conversation so the form's select has an option.
  useConversationsStore.setState({
    conversations: [mockConversation],
    activeId: mockConversation.id,
  });

  // Set up #root for DepthPanel's inert focus-trap.
  const rootEl = document.createElement('div');
  rootEl.id = 'root';
  document.body.appendChild(rootEl);

  // Default: empty schedule list.
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ schedules: [] }),
  });
});

afterEach(() => {
  document.getElementById('root')?.remove();
  vi.restoreAllMocks();
});

describe('<SchedulesPanel>', () => {
  it('shows empty state when there are no schedules', async () => {
    render(<SchedulesPanel open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/no scheduled agents yet/i)).toBeInTheDocument();
    });
  });

  it('shows schedule list when schedules are returned', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schedules: [
          {
            id: 's-1',
            name: 'Monday refresh',
            cron: '0 9 * * 1',
            prompt: 'refresh dashboard',
            conversationId: 'conv-1',
            enabled: true,
            createdAt: Date.now(),
            nextRun: Date.now() + 86_400_000,
          },
        ],
      }),
    });
    render(<SchedulesPanel open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Monday refresh')).toBeInTheDocument();
    });
    expect(screen.getByText('0 9 * * 1')).toBeInTheDocument();
  });

  it('opens the inline form when "+ New" is clicked', async () => {
    const user = userEvent.setup();
    render(<SchedulesPanel open onClose={vi.fn()} />);
    // Wait for empty state to load
    await waitFor(() => screen.getByText(/no scheduled agents yet/i));

    // There are two "New schedule" buttons: header + empty-state. Click the header one.
    const newBtns = screen.getAllByRole('button', { name: /new schedule/i });
    await user.click(newBtns[0]);
    expect(screen.getByText(/new schedule/i, { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('0 9 * * 1')).toBeInTheDocument();
  });

  it('submitting the form POSTs to /v1/schedules', async () => {
    const user = userEvent.setup();

    // POST returns the created schedule; subsequent GET returns it in list.
    const created = {
      id: 's-new',
      name: 'Test sched',
      cron: '0 8 * * *',
      prompt: 'do work',
      conversationId: 'conv-1',
      enabled: true,
      createdAt: Date.now(),
      nextRun: Date.now() + 3_600_000,
    };

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts?: RequestInit) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: async () => created });
      }
      // GET /v1/schedules — return empty on first call, list on subsequent.
      callCount++;
      return Promise.resolve({
        ok: true,
        json: async () => ({ schedules: callCount > 1 ? [created] : [] }),
      });
    });

    render(<SchedulesPanel open onClose={vi.fn()} />);
    await waitFor(() => screen.getByText(/no scheduled agents yet/i));

    // Open form via header "+ New" button
    const newBtns = screen.getAllByRole('button', { name: /new/i });
    await user.click(newBtns[0]);

    // Fill in fields
    await user.type(screen.getByPlaceholderText(/monday dashboard/i), 'Test sched');
    await user.type(screen.getByPlaceholderText('0 9 * * 1'), '0 8 * * *');
    await user.type(screen.getByPlaceholderText(/refresh the Q3/i), 'do work');

    // Submit
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/v1/schedules',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('displays the count badge when schedules exist', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        schedules: [
          {
            id: 's-1',
            name: 'Alpha',
            cron: '* * * * *',
            prompt: 'p',
            conversationId: 'conv-1',
            enabled: true,
            createdAt: Date.now(),
          },
          {
            id: 's-2',
            name: 'Beta',
            cron: '0 1 * * *',
            prompt: 'q',
            conversationId: 'conv-1',
            enabled: false,
            createdAt: Date.now(),
          },
        ],
      }),
    });
    render(<SchedulesPanel open onClose={vi.fn()} />);
    await waitFor(() => {
      // Badge shows 2
      expect(screen.getByText('2')).toBeInTheDocument();
    });
  });
});

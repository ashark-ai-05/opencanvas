import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecallPanel } from '../../app/src/components/RecallPanel';

beforeEach(() => {
  // #root for DepthPanel inert
  const rootEl = document.createElement('div');
  rootEl.id = 'root';
  document.body.appendChild(rootEl);

  // Mock fetch for /v1/search
  globalThis.fetch = vi.fn().mockImplementation((url: unknown) => {
    if (typeof url === 'string' && url.includes('/v1/search')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          results: [
            {
              id: 'hit-1',
              sourceId: 'conv-1#msg-3',
              kind: 'text-document',
              shape: { title: 'Pricing notes', body: 'The Q3 pricing model …' },
              provenance: { uri: 'kb://conv-1/msg-3', fetchedAt: Date.now() - 7200_000 },
              freshness: {},
              links: [],
            },
            {
              id: 'hit-2',
              sourceId: 'conv-2#widget-9',
              kind: 'code-file',
              shape: { title: 'Q3 revenue chart', body: 'line chart from sales table' },
              provenance: { uri: 'kb://conv-2/widget-9', fetchedAt: Date.now() - 86400_000 },
              freshness: {},
              links: [],
            },
          ],
        }),
      } as Response);
    }
    return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
  });
});

afterEach(() => {
  document.getElementById('root')?.remove();
  vi.restoreAllMocks();
});

describe('<RecallPanel>', () => {
  it('shows search input on mount', () => {
    render(<RecallPanel open onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText(/search across all conversations/i)).toBeInTheDocument();
  });

  it('fires an initial search and renders hits', async () => {
    render(<RecallPanel open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText('Pricing notes')).toBeInTheDocument();
      expect(screen.getByText('Q3 revenue chart')).toBeInTheDocument();
    });
  });

  it('typing a query triggers a debounced re-search', async () => {
    const user = userEvent.setup();
    render(<RecallPanel open onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText(/search across all conversations/i);
    await user.type(input, 'pricing');
    // wait past debounce
    await new Promise((r) => setTimeout(r, 350));
    // fetch should have been called more than once (initial + debounced)
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
  });

  it('filtering by kind hides non-matching hits', async () => {
    const user = userEvent.setup();
    render(<RecallPanel open onClose={vi.fn()} />);
    await waitFor(() => screen.getByText('Pricing notes'));
    // Click the 'code-file' chip to show only code-file hits
    const codeFileChip = screen.getByRole('button', { name: /^code-file$/i });
    await user.click(codeFileChip);
    // Now only the code-file hit should be visible
    expect(screen.queryByText('Pricing notes')).not.toBeInTheDocument();
    expect(screen.getByText('Q3 revenue chart')).toBeInTheDocument();
  });

  it('shows empty state when there are no hits', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as Response);
    render(<RecallPanel open onClose={vi.fn()} />);
    await waitFor(() => {
      expect(
        screen.getByText(/Search to recall|No matches/i),
      ).toBeInTheDocument();
    });
  });

  it('shows a Place on canvas button for each hit', async () => {
    render(<RecallPanel open onClose={vi.fn()} />);
    await waitFor(() => screen.getByText('Pricing notes'));
    const placeButtons = screen.getAllByRole('button', { name: /place on canvas/i });
    expect(placeButtons.length).toBe(2);
  });

  it('close button calls onClose', async () => {
    const onClose = vi.fn();
    render(<RecallPanel open onClose={onClose} />);
    const closeBtn = screen.getByRole('button', { name: /close recall/i });
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

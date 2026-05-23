import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SearchBar } from '../../app/src/components/SearchBar';

// Mock the dispatcher so we don't need a real tldraw editor.
vi.mock('../../app/src/canvas/dispatcher', () => ({
  placeResultsOnCanvas: vi.fn(),
}));

// Mock the editor hook from tldraw — return a minimal editor stub.
vi.mock('tldraw', () => ({
  useEditor: () => ({ createShape: vi.fn(), getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) }),
}));

describe('SearchBar', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ results: [] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders an input', () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('fires a search when the form is submitted', async () => {
    render(<SearchBar />);
    const input = screen.getByPlaceholderText(/search/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'authentication' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/v1/search',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});

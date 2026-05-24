import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HealthBadge } from '../../app/src/components/HealthBadge';

describe('HealthBadge', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          profile: 'test',
          llm: 'gemini',
          model: 'gemini-flash-lite-latest',
          embedder: 'onnx-bundled',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state initially', () => {
    render(<HealthBadge />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders ok state with the active LLM + model in the chip', async () => {
    // Refactor (commit b4b8c74): the visible chip shows `<llm> · <model>`
    // instead of the profile name. Profile + embedder move to the hover
    // tooltip for diagnostics.
    render(<HealthBadge />);
    await waitFor(() => {
      expect(screen.getByText('gemini')).toBeInTheDocument();
      expect(screen.getByText('gemini-flash-lite-latest')).toBeInTheDocument();
    });
  });

  it('exposes the profile name + embedder via the tooltip title', async () => {
    render(<HealthBadge />);
    await waitFor(() => {
      const llmText = screen.getByText('gemini');
      const chip = llmText.closest('[title]');
      expect(chip).not.toBeNull();
      expect(chip!.getAttribute('title')).toContain('profile: test');
      expect(chip!.getAttribute('title')).toContain('embed:   onnx-bundled');
    });
  });

  it('renders fail state when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('connection refused'));
    render(<HealthBadge />);
    await waitFor(() => {
      expect(screen.getAllByText(/connection refused|backend down|fail/i).length).toBeGreaterThan(0);
    });
  });
});

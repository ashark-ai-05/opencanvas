import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HealthBadge } from '../../app/src/components/HealthBadge';

describe('HealthBadge', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({ ok: true, profile: 'test', llm: 'claude-agent-sdk', embedder: 'onnx-bundled' }),
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

  it('renders ok state with profile after fetch resolves', async () => {
    render(<HealthBadge />);
    await waitFor(() => {
      expect(screen.getByText(/test/)).toBeInTheDocument();
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

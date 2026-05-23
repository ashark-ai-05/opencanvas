import { describe, it, expect, vi } from 'vitest';
import { fetchHealth } from '../../app/src/api/health';

describe('fetchHealth', () => {
  it('returns parsed JSON when backend responds 200', async () => {
    const stub = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, profile: 'test', llm: 'x', embedder: 'y' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const result = await fetchHealth();
    expect(result.ok).toBe(true);
    expect(result.profile).toBe('test');
    stub.mockRestore();
  });

  it('throws when backend returns non-200', async () => {
    const stub = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('error', { status: 500 })
    );
    await expect(fetchHealth()).rejects.toThrow(/500/);
    stub.mockRestore();
  });
});

import { describe, it, expect } from 'vitest';
import { app } from '../src/backend/server.js';

describe('POST /v1/search', () => {
  it('returns 400 when query is missing or empty', async () => {
    const r1 = await app.request('/v1/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r1.status).toBe(400);

    const r2 = await app.request('/v1/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '   ' }),
    });
    expect(r2.status).toBe(400);
  });

  it('returns 200 with a results array on a valid query', async () => {
    const res = await app.request('/v1/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'authentication' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { results: unknown[] };
    expect(Array.isArray(json.results)).toBe(true);
  });
});

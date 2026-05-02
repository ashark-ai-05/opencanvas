import { describe, it, expect } from 'vitest';
import { BackendState } from '../src/backend/state.js';
import { app } from '../src/backend/server.js';

describe('BackendState', () => {
  it('lazily creates the LLM provider for the active profile', async () => {
    const state = await BackendState.create();
    const provider = state.getLLMProvider();
    expect(provider.kind).toBeDefined();
    expect(provider.id).toBeDefined();
  });

  it('lazily creates the embedder for the active profile', async () => {
    const state = await BackendState.create();
    const embedder = state.getEmbedder();
    expect(embedder.dims).toBeGreaterThan(0);
    expect(embedder.id).toBeDefined();
  });

  it('returns the profile name', async () => {
    const state = await BackendState.create();
    expect(typeof state.profileName).toBe('string');
    expect(state.profileName.length).toBeGreaterThan(0);
  });

  it('source registry starts empty until ensureSourcesConnected is awaited', async () => {
    const state = await BackendState.create();
    expect(state.getSourceRegistry().list()).toEqual([]);
  });
});

describe('GET /v1/health', () => {
  it('returns ok with profile metadata', async () => {
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; profile: string };
    expect(json.ok).toBe(true);
    expect(typeof json.profile).toBe('string');
  });
});

describe('GET /v1/sources', () => {
  it('returns the configured source list (possibly empty)', async () => {
    const res = await app.request('/v1/sources');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sources: { id: string; name: string }[] };
    expect(Array.isArray(json.sources)).toBe(true);
  });
});

describe('POST /v1/embed', () => {
  it('returns 400 when texts is missing or empty', async () => {
    const r1 = await app.request('/v1/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r1.status).toBe(400);

    const r2 = await app.request('/v1/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: [] }),
    });
    expect(r2.status).toBe(400);
  });

  // The actual embedding call hits the model; we don't run it here
  // (would slow tests and require model download). Coverage of the
  // happy path comes via the live `pnpm cli --embed` smoke from Plan 1
  // and the curl example in the README.
});

describe('POST /v1/query', () => {
  it('returns 400 when prompt is missing', async () => {
    const res = await app.request('/v1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 with text/event-stream content-type when prompt is provided', async () => {
    // The actual provider may attempt a real call; for this unit test we
    // only verify the wire-up: status code and content-type. The provider
    // call is exercised in CLI / integration tests elsewhere.
    const res = await app.request('/v1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  });
});

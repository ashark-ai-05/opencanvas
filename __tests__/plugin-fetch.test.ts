import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pluginFetchRoute } from '../src/backend/routes/plugin-fetch.js';

// Mock DNS to control what hostnames resolve to (so tests don't depend on network)
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => {
    if (host === 'private.example.com') return { address: '10.0.0.5' };
    if (host === 'meta.example.com') return { address: '169.254.169.254' };
    return { address: '93.184.216.34' }; // example.com — public
  }),
}));

function makeMockFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: {
      getReader: () => {
        let done = false;
        return {
          read: async () => {
            if (done) return { done: true, value: undefined };
            done = true;
            return { done: false, value: new TextEncoder().encode('{"ok":true}') };
          },
          cancel: async () => {},
        };
      },
    },
  });
}

beforeEach(() => {
  globalThis.fetch = makeMockFetch();
});

async function callRoute(url: string, init: RequestInit = {}) {
  const route = pluginFetchRoute({} as never);
  return route.request(url, init);
}

async function jsonBody(res: Response): Promise<{ error: string }> {
  return res.json() as Promise<{ error: string }>;
}

describe('GET /v1/plugin-fetch', () => {
  it('returns 400 when url param is missing', async () => {
    const res = await callRoute('http://localhost/v1/plugin-fetch');
    expect(res.status).toBe(400);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/url required/i);
  });

  it('forwards a valid GET and returns the upstream body', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' + encodeURIComponent('https://example.com/data'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('x-plugin-fetch-upstream-status')).toBe('200');
    const body = await res.text();
    expect(body).toBe('{"ok":true}');
  });

  it('passes through content-type from upstream', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' + encodeURIComponent('https://example.com/data'),
    );
    expect(res.headers.get('content-type')).toBe('application/json');
  });

  it('blocks private IPs (DNS-resolved)', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' + encodeURIComponent('https://private.example.com/foo'),
    );
    expect(res.status).toBe(400);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/private/i);
  });

  it('blocks cloud metadata IP (link-local 169.254.x.x)', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' + encodeURIComponent('https://meta.example.com/foo'),
    );
    expect(res.status).toBe(400);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/private/i);
  });

  it('blocks localhost by name', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' + encodeURIComponent('http://localhost:8080/foo'),
    );
    expect(res.status).toBe(400);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/blocked/i);
  });

  it('blocks 127.0.0.1 by IP literal', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' + encodeURIComponent('http://127.0.0.1:8080/foo'),
    );
    expect(res.status).toBe(400);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/blocked/i);
  });

  it('blocks 10.x.x.x private IP literal', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' + encodeURIComponent('http://10.0.0.1/foo'),
    );
    expect(res.status).toBe(400);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/blocked/i);
  });

  it('blocks 192.168.x.x private IP literal', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' + encodeURIComponent('http://192.168.1.1/foo'),
    );
    expect(res.status).toBe(400);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/blocked/i);
  });

  it('blocks file:// scheme', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' + encodeURIComponent('file:///etc/passwd'),
    );
    expect(res.status).toBe(400);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/protocol/i);
  });

  it('blocks invalid method', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' +
        encodeURIComponent('https://example.com/') +
        '&method=CONNECT',
    );
    expect(res.status).toBe(400);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/method not allowed/i);
  });

  it('strips forbidden headers (Authorization, Cookie) and passes allowed ones', async () => {
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    fetchSpy.mockClear();

    const headers = JSON.stringify({
      'X-Custom': 'ok',
      'Authorization': 'Bearer leaked',
      'cookie': 'session=secret',
    });

    await callRoute(
      'http://localhost/v1/plugin-fetch?url=' +
        encodeURIComponent('https://example.com/') +
        '&headers=' +
        encodeURIComponent(headers),
    );

    expect(fetchSpy).toHaveBeenCalledOnce();
    const callArgs = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(callArgs.headers).toEqual({ 'X-Custom': 'ok' });
  });

  it('returns 502 on upstream fetch error', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('connection refused'),
    );
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' + encodeURIComponent('https://example.com/fail'),
    );
    expect(res.status).toBe(502);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/upstream/i);
  });

  it('blocks *.localhost subdomains', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' +
        encodeURIComponent('http://anything.localhost/foo'),
    );
    expect(res.status).toBe(400);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/blocked/i);
  });

  it('blocks metadata.google.internal', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' +
        encodeURIComponent('http://metadata.google.internal/computeMetadata/v1/'),
    );
    expect(res.status).toBe(400);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/blocked/i);
  });

  it('returns 400 on invalid JSON in headers param', async () => {
    const res = await callRoute(
      'http://localhost/v1/plugin-fetch?url=' +
        encodeURIComponent('https://example.com/') +
        '&headers=not-valid-json',
    );
    expect(res.status).toBe(400);
    const json = await jsonBody(res);
    expect(json.error).toMatch(/headers/i);
  });
});

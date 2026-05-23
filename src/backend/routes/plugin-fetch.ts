import { Hono } from 'hono';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { BackendState } from '../state.js';

/**
 * /v1/plugin-fetch — outbound HTTP proxy for sandboxed plugin iframes.
 *
 * Sandboxed iframes run with `allow-scripts` only, which gives them a `null`
 * origin. Many APIs (private, financial, etc.) reject requests from a null
 * origin via CORS. This proxy strips the null origin and forwards the request
 * server-side, then returns the response with permissive CORS headers so the
 * iframe can read it.
 *
 * SSRF guards: blocks loopback, private, link-local, ULA addresses; blocked
 * hostnames (localhost, cloud metadata); and non-http(s) schemes.
 * Forbidden headers (Authorization, Cookie, Origin, etc.) are stripped.
 * Response is capped at 8 MB; timeout is 15 seconds.
 */

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

const FORBIDDEN_HEADERS = new Set([
  'host',
  'cookie',
  'authorization',
  'proxy-authorization',
  'origin',
  'referer',
  'x-forwarded-for',
  'x-real-ip',
]);

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const TIMEOUT_MS = 15_000; // 15 seconds

const FORBIDDEN_HOSTS = new Set([
  'localhost',
  '0.0.0.0',
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

function isPrivateOrLoopback(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 127) return true;                                      // 127/8 loopback
    if (parts[0] === 10) return true;                                       // 10/8 private
    if (parts[0] === 169 && parts[1] === 254) return true;                  // 169.254/16 link-local
    if (parts[0] === 172 && parts[1] !== undefined && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16/12 private
    if (parts[0] === 192 && parts[1] === 168) return true;                  // 192.168/16 private
    if (parts[0] === 0) return true;                                        // 0/8
    return false;
  }
  if (v === 6) {
    if (ip === '::1') return true;                                          // IPv6 loopback
    const lower = ip.toLowerCase();
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;      // fc00::/7 ULA
    if (lower.startsWith('fe80')) return true;                              // fe80::/10 link-local
    return false;
  }
  return false;
}

type ValidatedUrl = URL | { error: string };

async function validateUrl(rawUrl: string): Promise<ValidatedUrl> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: 'invalid url' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { error: `protocol not allowed: ${url.protocol}` };
  }

  const host = url.hostname.toLowerCase();

  if (FORBIDDEN_HOSTS.has(host)) {
    return { error: `host blocked: ${host}` };
  }
  if (host.endsWith('.localhost')) {
    return { error: `host blocked: ${host}` };
  }

  // If the hostname is already an IP literal, check it directly.
  // Otherwise resolve via DNS and check the resolved address.
  if (isIP(host) !== 0) {
    if (isPrivateOrLoopback(host)) {
      return { error: `IP blocked: ${host}` };
    }
  } else {
    let resolved: { address: string };
    try {
      resolved = await lookup(host);
    } catch {
      return { error: `dns lookup failed: ${host}` };
    }
    if (isPrivateOrLoopback(resolved.address)) {
      return { error: `host resolves to private IP: ${host} → ${resolved.address}` };
    }
  }

  return url;
}

function sanitizeHeaders(input: Record<string, string> | undefined): Record<string, string> {
  if (!input) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (FORBIDDEN_HEADERS.has(k.toLowerCase())) continue;
    if (typeof v !== 'string') continue;
    out[k] = v;
  }
  return out;
}

export function pluginFetchRoute(_state: BackendState): Hono {
  const r = new Hono();

  const handle = async (c: import('hono').Context) => {
    const params = c.req.query();
    const url = params['url'];
    if (!url) return c.json({ error: 'url required' }, 400);

    // Method: explicit ?method= param wins, then the actual HTTP method.
    const method = (params['method'] ?? c.req.method).toUpperCase();
    if (!ALLOWED_METHODS.has(method)) {
      return c.json({ error: `method not allowed: ${method}` }, 400);
    }

    const validated = await validateUrl(url);
    if ('error' in validated) {
      return c.json({ error: validated.error }, 400);
    }

    // Parse and sanitize optional headers query param.
    let headers: Record<string, string> = {};
    if (params['headers']) {
      try {
        headers = sanitizeHeaders(JSON.parse(params['headers']) as Record<string, string>);
      } catch {
        return c.json({ error: 'invalid headers JSON' }, 400);
      }
    }

    // Forward the request with a timeout.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let upstream: Response;
    try {
      const init: RequestInit = { method, headers, signal: ctrl.signal };
      // Pass through request body for methods that support it.
      if (method !== 'GET' && method !== 'HEAD') {
        const buf = await c.req.arrayBuffer();
        if (buf.byteLength > 0) {
          init.body = buf;
        }
      }
      upstream = await fetch(validated.toString(), init);
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: `upstream ${msg}` }, 502);
    } finally {
      clearTimeout(timer);
    }

    // Build the response headers we want to pass through.
    const passThruHeaders: Record<string, string> = {
      'access-control-allow-origin': '*',
      'x-plugin-fetch-upstream-status': String(upstream.status),
    };
    const ct = upstream.headers.get('content-type');
    if (ct) passThruHeaders['content-type'] = ct;

    // Stream the body but cap at MAX_BYTES to prevent DoS via large responses.
    const reader = upstream.body?.getReader();
    if (!reader) {
      return new Response(null, { status: upstream.status, headers: passThruHeaders });
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          try { await reader.cancel(); } catch { /* ignore cancel errors */ }
          return c.json({ error: `response too large (>${MAX_BYTES} bytes)` }, 502);
        }
        chunks.push(value);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: `upstream read error: ${msg}` }, 502);
    }

    // Merge chunks into a single Uint8Array.
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return new Response(merged, { status: upstream.status, headers: passThruHeaders });
  };

  // Mount all allowed HTTP methods via .on() — Hono's .all() includes methods
  // like CONNECT/TRACE which we don't want; listing them explicitly is cleaner.
  // HEAD is included for completeness (e.g. checking Content-Type before fetch).
  for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    r.on(m, '/v1/plugin-fetch', handle);
  }

  return r;
}

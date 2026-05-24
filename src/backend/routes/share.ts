import { Hono } from 'hono';
import type { BackendState } from '../state.js';

/**
 * /v1/share — viral-loop endpoints.
 *
 *   POST /v1/share     create a share from the current canvas + chat
 *   GET  /v1/share/:id read a share (read-only); also bumps view_count
 *
 * Anonymous (no auth). Per-IP creation rate limit + payload size cap
 * (256KB serialized) keep abuse manageable. IDs are random UUIDs so
 * there's no enumeration attack surface.
 */

type ShareCreateBody = {
  canvasSnapshot?: unknown;
  messages?: unknown;
  meta?: Record<string, unknown>;
};

/**
 * Per-IP rate limiter for share CREATION specifically. Read endpoint
 * is uncapped — viewing a share that already exists is cheap.
 *
 * Bucket: 10 shares per hour per IP. Light enough that a real user
 * creating a few shares of different conversations is fine; tight
 * enough that automated abuse (paste-and-share-1000-times) gets
 * blocked.
 */
const CREATE_CAPACITY = 10;
const CREATE_REFILL_MS = (60 * 60 * 1000) / CREATE_CAPACITY; // 1 token per 6 min
const CREATE_BUCKETS = new Map<string, { tokens: number; lastRefill: number }>();

function takeCreateToken(ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  let bucket = CREATE_BUCKETS.get(ip);
  if (!bucket) {
    bucket = { tokens: CREATE_CAPACITY, lastRefill: now };
    CREATE_BUCKETS.set(ip, bucket);
  } else {
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      const refill = Math.floor(elapsed / CREATE_REFILL_MS);
      if (refill > 0) {
        bucket.tokens = Math.min(CREATE_CAPACITY, bucket.tokens + refill);
        bucket.lastRefill += refill * CREATE_REFILL_MS;
      }
    }
  }
  if (bucket.tokens <= 0) {
    const retryAfterSec = Math.ceil(
      (CREATE_REFILL_MS - (now - bucket.lastRefill)) / 1000,
    );
    return { ok: false, retryAfterSec: Math.max(retryAfterSec, 1) };
  }
  bucket.tokens -= 1;
  return { ok: true };
}

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-real-ip') ??
    'unknown'
  );
}

export function shareRoute(state: BackendState): Hono {
  const r = new Hono();

  // POST /v1/share — create a new share, return its id
  r.post('/v1/share', async (c) => {
    const ip = clientIp(c);
    const gate = takeCreateToken(ip);
    if (!gate.ok) {
      c.header('Retry-After', String(gate.retryAfterSec));
      return c.json(
        {
          error: 'rate_limited',
          hint: `Share creation is capped at ${CREATE_CAPACITY} per hour per IP. Try again in ~${Math.ceil(gate.retryAfterSec / 60)} min.`,
        },
        429,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as ShareCreateBody;
    if (!body || typeof body !== 'object') {
      return c.json({ error: 'invalid body' }, 400);
    }
    if (!body.canvasSnapshot) {
      return c.json({ error: 'canvasSnapshot is required' }, 400);
    }
    if (!Array.isArray(body.messages)) {
      return c.json({ error: 'messages must be an array' }, 400);
    }

    const store = await state.getShareStore();
    try {
      const { id, createdAt } = store.create({
        canvasSnapshot: body.canvasSnapshot,
        messages: body.messages,
        ...(body.meta ? { meta: body.meta } : {}),
      });
      return c.json({ ok: true, id, createdAt, url: `/share/${id}` });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Size-cap rejection becomes a 413
      if (message.includes('too large')) {
        return c.json({ error: 'payload_too_large', hint: message }, 413);
      }
      console.error('[share] create failed:', message);
      return c.json({ error: 'create_failed', hint: message }, 500);
    }
  });

  // GET /v1/share/:id — read a share; bumps view_count
  r.get('/v1/share/:id', async (c) => {
    const id = c.req.param('id');
    if (!id || !/^[a-f0-9-]{36}$/i.test(id)) {
      return c.json({ error: 'invalid_id' }, 400);
    }
    const store = await state.getShareStore();
    const record = store.get(id);
    if (!record) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json({
      ok: true,
      id: record.id,
      createdAt: record.createdAt,
      viewCount: record.viewCount,
      data: record.data,
    });
  });

  return r;
}

/**
 * Demo mode — the configuration shifts that turn the locally-trusted
 * OpenCanvas backend into a public-facing demo on Railway.
 *
 * Enabled when OPENCANVAS_DEMO=1.
 *
 * What it does:
 *   1. Auth is skipped on /v1/* (visitors have no token).
 *   2. CORS allows any origin (the Railway URL plus whatever frontend
 *      mirrors might exist).
 *   3. /v1/chat is rate-limited per IP — token bucket sized for the
 *      "5 messages / hour / IP" cap. Other routes pass through.
 *   4. Auto-indexing of conversations into the KB is disabled so
 *      visitor A's chats don't leak into visitor B's search results.
 *
 * Single-process in-memory state. Acceptable for one Railway instance;
 * if we ever scale horizontally we'd swap the bucket for Redis.
 */
import type { MiddlewareHandler } from 'hono';

export function isDemoMode(): boolean {
  return process.env['OPENCANVAS_DEMO'] === '1';
}

/**
 * Per-IP token bucket. capacity = 5 messages; refill 1 token every 12
 * minutes (5/hour). Buckets are evicted when stale > 24h to bound
 * memory under a sustained attack.
 */
type Bucket = { tokens: number; lastRefill: number };
const CAPACITY = 5;
const REFILL_MS = (60 * 60 * 1000) / CAPACITY; // one token per 12 min
const STALE_MS = 24 * 60 * 60 * 1000;
const buckets = new Map<string, Bucket>();

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  // Railway sits behind their edge proxy — the original client IP
  // arrives in x-forwarded-for. Fall back to other headers and finally
  // a constant so we never key the bucket on undefined.
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return (
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-real-ip') ??
    'unknown'
  );
}

function take(ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = { tokens: CAPACITY, lastRefill: now };
    buckets.set(ip, bucket);
  } else {
    // Refill the bucket lazily — tokens accumulate up to CAPACITY.
    const elapsed = now - bucket.lastRefill;
    if (elapsed > 0) {
      const refill = Math.floor(elapsed / REFILL_MS);
      if (refill > 0) {
        bucket.tokens = Math.min(CAPACITY, bucket.tokens + refill);
        bucket.lastRefill += refill * REFILL_MS;
      }
    }
  }
  if (bucket.tokens <= 0) {
    const retryAfterSec = Math.ceil((REFILL_MS - (now - bucket.lastRefill)) / 1000);
    return { ok: false, retryAfterSec: Math.max(retryAfterSec, 1) };
  }
  bucket.tokens -= 1;
  return { ok: true };
}

// Periodic eviction so the Map can't grow unbounded.
setInterval(() => {
  const cutoff = Date.now() - STALE_MS;
  for (const [ip, b] of buckets) {
    if (b.lastRefill < cutoff && b.tokens >= CAPACITY) {
      buckets.delete(ip);
    }
  }
}, 60 * 60 * 1000).unref?.();

/**
 * Demo rate-limit middleware for /v1/chat. Only enforced when
 * isDemoMode(). Skipped for OPTIONS preflight.
 */
export const demoRateLimit: MiddlewareHandler = async (c, next) => {
  if (!isDemoMode()) return next();
  if (c.req.method === 'OPTIONS') return next();
  const ip = clientIp(c);
  const result = take(ip);
  if (!result.ok) {
    c.header('Retry-After', String(result.retryAfterSec));
    return c.json(
      {
        error: 'rate_limited',
        hint: `Demo cap: ${CAPACITY} messages per hour per IP. Try again in ~${Math.ceil(result.retryAfterSec / 60)} min.`,
      },
      429,
    );
  }
  return next();
};

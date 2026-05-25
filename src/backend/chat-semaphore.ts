/**
 * Global concurrency cap on /v1/chat for the demo deployment.
 *
 * Why: per-IP rate limiting (see demo.ts) prevents one visitor from
 * monopolising the demo, but doesn't prevent N distinct visitors from
 * collectively bursting through the upstream model's RPM quota — the
 * actual failure mode under HN-style traffic spikes. This semaphore
 * caps in-flight /v1/chat requests at a small fixed number so the
 * upstream provider's RPM is naturally throttled and the (N+1)th
 * visitor gets a clean 503 with a "BYO your own key" message instead
 * of opaque rate-limit errors from the provider.
 *
 * Tunable via OPENCANVAS_CHAT_MAX_CONCURRENT (default 10). Set to 0
 * to disable (used in tests and non-demo deployments).
 *
 * Single-process in-memory state. Same scaling caveat as demo.ts:
 * fine for one Railway replica; replace with Redis if we ever scale
 * horizontally.
 */

export interface ChatSemaphore {
  /** Try to acquire a slot. Returns false if no capacity. */
  tryAcquire(): boolean;
  /** Release a previously-acquired slot. Idempotent per Lease. */
  release(): void;
  /** Current in-flight count — for observability. */
  inFlight(): number;
  /** Configured max — for observability. */
  capacity(): number;
}

export function createChatSemaphore(maxConcurrent: number): ChatSemaphore {
  let current = 0;
  return {
    tryAcquire(): boolean {
      // capacity 0 = disabled: every acquire succeeds, release is a no-op.
      if (maxConcurrent <= 0) return true;
      if (current >= maxConcurrent) return false;
      current += 1;
      return true;
    },
    release(): void {
      if (maxConcurrent <= 0) return;
      if (current > 0) current -= 1;
    },
    inFlight(): number {
      return current;
    },
    capacity(): number {
      return maxConcurrent;
    },
  };
}

/**
 * Wrap a tryAcquire result into a single-use lease so the caller
 * can't accidentally double-release on retry paths. release() after
 * the first call is a no-op.
 */
export function leaseFrom(sem: ChatSemaphore): { released: boolean; release: () => void } {
  const lease = {
    released: false,
    release(): void {
      if (lease.released) return;
      lease.released = true;
      sem.release();
    },
  };
  return lease;
}

let processSem: ChatSemaphore | null = null;

/**
 * Process-wide singleton, configured once from env at first access.
 * Wrap-once pattern so the semaphore survives hot reloads in dev and
 * starts fresh at process boot in production.
 */
export function getProcessChatSemaphore(): ChatSemaphore {
  if (processSem) return processSem;
  const raw = process.env['OPENCANVAS_CHAT_MAX_CONCURRENT'];
  const n = raw === undefined ? 10 : Number.parseInt(raw, 10);
  processSem = createChatSemaphore(Number.isFinite(n) ? n : 10);
  return processSem;
}

/** Reset the process-wide semaphore — test-only. */
export function __resetProcessChatSemaphoreForTests(): void {
  processSem = null;
}

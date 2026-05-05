/**
 * Shared HTTP client used by every KB connector.
 *
 * Wraps fetch() with:
 *   - configurable per-call + per-instance timeout (AbortSignal.timeout)
 *   - jittered exponential backoff on 5xx / network errors (3 retries)
 *   - typed JSON response shaping
 *   - default Authorization / Accept headers
 *
 * Connectors MUST go through this — never raw fetch — so retry budgets
 * and timeouts are uniform across the pipeline.
 *
 * Spec: REPLICATION-PROMPT.md §9 — connectors/http-client.ts.
 */

export type HttpClientOptions = {
  baseUrl: string;
  /** Bearer token (Stash/Jira/Confluence PATs). Optional for public APIs. */
  token?: string;
  /** Extra headers merged into every request. */
  headers?: Record<string, string>;
  /** Per-request timeout in ms (default 30s). */
  timeoutMs?: number;
  /** Retry attempts on 5xx / network error (default 3). */
  maxRetries?: number;
};

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly url: string,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 3;
    this.headers = {
      accept: 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {}),
    };
  }

  /**
   * GET → JSON. `path` is appended to baseUrl; pass query params via
   * `searchParams` to get correct URI encoding.
   */
  async getJson<T>(
    path: string,
    searchParams?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const url = this.buildUrl(path, searchParams);
    return this.requestWithRetry<T>('GET', url);
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const url = this.buildUrl(path);
    return this.requestWithRetry<T>('POST', url, body);
  }

  private buildUrl(
    path: string,
    searchParams?: Record<string, string | number | undefined>,
  ): string {
    const safePath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(this.baseUrl + safePath);
    if (searchParams) {
      for (const [k, v] of Object.entries(searchParams)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async requestWithRetry<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.requestOnce<T>(method, url, body);
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err) || attempt === this.maxRetries) {
          throw err;
        }
        // Exponential backoff with jitter: base * 2^n + rand(0..base).
        const base = 250;
        const wait = base * 2 ** attempt + Math.floor(Math.random() * base);
        await sleep(wait);
      }
    }
    // Unreachable — the loop either returns or throws.
    throw lastErr;
  }

  private async requestOnce<T>(
    method: string,
    url: string,
    body?: unknown,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          ...this.headers,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new HttpError(
          `${method} ${url} → ${res.status}`,
          res.status,
          url,
          text,
        );
      }
      // 204 / empty → return null cast.
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.includes('json')) {
        return undefined as unknown as T;
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof HttpError) {
    return err.status >= 500 || err.status === 429;
  }
  // Network error / timeout / abort — generally retryable.
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

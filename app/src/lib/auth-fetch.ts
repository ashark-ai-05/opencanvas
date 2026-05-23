/**
 * Global fetch wrapper that attaches the OpenCanvas backend auth token
 * to every /v1/* request when the runtime exposes it.
 *
 * Runtime matrix:
 *   - Vite dev / Electron dev → proxy injects header server-side; this
 *     wrapper is a no-op. `window.opencanvasAuth` is undefined.
 *   - Packaged Electron       → preload sets `window.opencanvasAuth`
 *     via contextBridge; this wrapper resolves it once at boot, caches
 *     it, and attaches `X-OpenCanvas-Token` to every backend request.
 *
 * Installed exactly once from main.tsx. Calling it twice is a no-op.
 */
type AuthBridge = { getToken: () => Promise<string> };

let installed = false;

export function installAuthFetch(): void {
  if (installed) return;
  installed = true;

  const bridge = (globalThis as unknown as { opencanvasAuth?: AuthBridge })
    .opencanvasAuth;
  if (!bridge) return; // dev / browser path — proxy handles auth

  let tokenPromise: Promise<string> | null = null;
  const getToken = () => {
    if (!tokenPromise) tokenPromise = bridge.getToken();
    return tokenPromise;
  };

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    // Only the backend API needs the header. Skip for asset URLs, third
    // parties, data: / blob: URIs — attaching a token there would leak.
    const isBackend =
      url.startsWith('/v1/') ||
      url.includes('://localhost:3457/v1/') ||
      url.includes('://127.0.0.1:3457/v1/');
    if (!isBackend) return originalFetch(input, init);

    const token = await getToken();
    const headers = new Headers(init?.headers);
    if (!headers.has('X-OpenCanvas-Token')) {
      headers.set('X-OpenCanvas-Token', token);
    }
    return originalFetch(input, { ...init, headers });
  }) as typeof fetch;
}

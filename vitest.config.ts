import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Root config: Node-only tests. App tests use app/vite.config.ts (jsdom env).
    environment: 'node',
    include: ['__tests__/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['__tests__/app/**', 'node_modules/**', 'app/**'],
    // Bundled-onnx embedder downloads + initialises BAAI/bge-small-en-v1.5
    // on first test-run (≈100MB cache + load). 5s is too tight; 60s is
    // generous but still catches genuine hangs. Per-test override via
    // `it('...', { timeout: N }, …)` for cases that need more.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

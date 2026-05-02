import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Root config: Node-only tests. App tests use app/vite.config.ts (jsdom env).
    environment: 'node',
    include: ['__tests__/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    exclude: ['__tests__/app/**', 'node_modules/**', 'app/**'],
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  server: {
    port: 3458,
    strictPort: true,
    // Proxy /v1/* requests to the backend on :3457 so the SPA can
    // hit a same-origin /v1/* path without CORS issues in dev.
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:3457',
        changeOrigin: false,
        // Streaming endpoints (like /v1/query/openai) need pass-through.
        // Vite's http-proxy supports this by default; no extra config needed.
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';

// The dev proxy reads ~/.opencanvas/auth-token at request-time and
// injects it as X-OpenCanvas-Token. The browser never sees the token —
// it stays on the file system + the proxy server. Cache after first
// successful read so we're not re-reading on every request.
const TOKEN_FILE = path.join(homedir(), '.opencanvas', 'auth-token');
let cachedToken: string | null = null;
function readAuthToken(): string | null {
  if (cachedToken) return cachedToken;
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    const t = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t.length >= 16) {
      cachedToken = t;
      return t;
    }
  } catch {
    // ignore — backend may still be writing the file
  }
  return null;
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  server: {
    // Bind to loopback only — the dev server has no auth and exposes
    // the proxy to whatever it can reach. Was 0.0.0.0 (LAN-accessible)
    // which is unsafe on shared networks (coffee shops, hotel wifi).
    host: '127.0.0.1',
    port: 3458,
    strictPort: true,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:3457',
        changeOrigin: false,
        // Streaming endpoints (like /v1/query/openai) need pass-through.
        // Vite's http-proxy supports this by default.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const token = readAuthToken();
            if (token) proxyReq.setHeader('X-OpenCanvas-Token', token);
          });
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Vendor split. Without manualChunks, Rollup throws everything
    // not lazy-imported into one big `index-*.js` (~2.4 MB / 720 KB
    // gzip). Splitting tldraw + ai-sdk + shiki + markdown out gives
    // the browser parallel downloads on first paint and lets the
    // already-cached vendor chunks survive across app updates.
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/tldraw/') || id.includes('/@tldraw/')) {
            return 'vendor-tldraw';
          }
          if (
            id.includes('/ai/') ||
            id.includes('/@ai-sdk/') ||
            id.includes('/@anthropic-ai/') ||
            id.includes('/openai/')
          ) {
            return 'vendor-ai';
          }
          if (id.includes('/shiki/') || id.includes('/@shikijs/')) {
            return 'vendor-shiki';
          }
          if (
            id.includes('/react-markdown/') ||
            id.includes('/remark-') ||
            id.includes('/micromark-') ||
            id.includes('/mdast-')
          ) {
            return 'vendor-markdown';
          }
          if (id.includes('/framer-motion/') || id.includes('/motion-')) {
            return 'vendor-motion';
          }
          if (id.includes('/lucide-react/')) {
            return 'vendor-icons';
          }
          if (id.includes('/react/') || id.includes('/react-dom/')) {
            return 'vendor-react';
          }
          return 'vendor';
        },
      },
    },
    // Raise the warning threshold — even split, the tldraw chunk is
    // ~500-700 KB by itself. That's intrinsic to the library.
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [path.resolve(__dirname, 'src/test-setup.ts')],
    include: [path.resolve(__dirname, '../__tests__/app/**/*.{test,spec}.?(c|m)[jt]s?(x)')],
  },
});

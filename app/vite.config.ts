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
          // No manual chunk for the markdown ecosystem.
          //
          // We tried splitting react-markdown/remark-*/micromark-*/mdast-* into
          // their own `vendor-markdown` chunk, then widened it to cover the
          // whole unified/vfile/hast-/unist-/character-entities/property-
          // information surface — but other packages in the catch-all `vendor`
          // chunk also pull from the markdown ecosystem, producing circular
          // cross-chunk imports that minify into a TDZ ("Cannot access 'X'
          // before initialization") error in production.
          //
          // Keeping markdown in `vendor` adds ~140KB raw / ~40KB gzipped to
          // the main vendor chunk, which is acceptable. The other manual
          // chunks (tldraw, ai, shiki, motion, icons, react) stay because
          // their dep graphs are isolated and the size win is bigger.
          if (id.includes('/framer-motion/') || id.includes('/motion-')) {
            return 'vendor-motion';
          }
          if (id.includes('/lucide-react/')) {
            return 'vendor-icons';
          }
          // No manual chunk for react/react-dom.
          //
          // Splitting react+react-dom into vendor-react produced a circular
          // cross-chunk import: vendor-react imported 14 symbols from the
          // catch-all `vendor` (utilities that happen to live next to react)
          // and `vendor` imported 16 symbols from vendor-react (anything in
          // the catch-all that uses React itself — which is ~half of vendor).
          // Under Rollup's minified output this minified into
          //   Uncaught ReferenceError: Cannot access 'Z' before initialization
          //     at vendor-D-7Zb80G.js:9:4310
          // (Z is the minified name of one of the symbols re-exported through
          // the cycle). The error was masked while the markdown chunk was
          // also creating a cycle — once that one was removed, eval order
          // shifted and the react cycle started firing.
          //
          // Letting react live in `vendor` adds ~194KB raw / ~60KB gzipped
          // to the main vendor chunk. The remaining manual chunk
          // (vendor-tldraw) is genuinely isolated and big enough that
          // splitting it still pays off; everything else folds in.
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

#!/usr/bin/env node
/**
 * Record a demo GIF of the OpenCanvas UI without a sudo-installed Chrome.
 *
 * - Boots a Playwright `chromium-headless-shell` (already installed via
 *   `npx playwright install chromium`).
 * - Drives the running Vite app at http://127.0.0.1:3458.
 * - Uses tldraw's `editor` global (exposed by the editor-ref singleton)
 *   to programmatically place a small storyboard of widgets — this skips
 *   the LLM cost + non-determinism of a real chat turn.
 * - Captures a sequence of PNG frames.
 * - Stitches them into `docs/demo.gif` with the bundled ffmpeg-static
 *   binary (no system ffmpeg needed).
 *
 * Run:
 *   pnpm dev               # in another terminal
 *   node scripts/record-demo.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const OUT_DIR = join(REPO, 'docs', 'demo-frames');
const GIF_PATH = join(REPO, 'docs', 'demo.gif');
const APP_URL = 'http://127.0.0.1:3458/';
const FFMPEG = (await import('ffmpeg-static')).default;
const W = 1280;
const H = 800;
const FRAME_DELAY_MS = 800;

async function ensureCleanFrames() {
  await mkdir(OUT_DIR, { recursive: true });
  for (const f of await readdir(OUT_DIR)) {
    if (f.endsWith('.png')) await unlink(join(OUT_DIR, f));
  }
}

let frameNo = 0;
async function snap(page, label) {
  const file = join(OUT_DIR, `frame-${String(++frameNo).padStart(3, '0')}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`[record-demo] ${label} → ${file}`);
  return file;
}

async function placeWidget(page, kind, role, payload) {
  await page.evaluate(
    ({ kind, role, payload }) => {
      // Reach the singleton editor handle published by Canvas.tsx onMount.
      // The store is exposed via window for the demo recorder; in normal
      // operation the dispatcher is called from the chat side.
      const w = window;
      const editor = w.__opencanvasEditorForDemo__ ?? w.editor;
      if (!editor) throw new Error('editor handle not available');
      const dispatcher = w.__opencanvasDispatcher__;
      if (!dispatcher) throw new Error('dispatcher not exposed');
      const id = crypto.randomUUID();
      dispatcher(editor, { type: 'place', id, kind, role, payload }, 'ask-anything');
    },
    { kind, role, payload },
  );
}

async function main() {
  await ensureCleanFrames();

  console.log('[record-demo] launching chromium-headless-shell …');
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium', // bundled
  });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1.5, // crisper text in the gif
    colorScheme: 'dark',
  });
  const page = await context.newPage();

  console.log('[record-demo] navigate', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

  // Wait for the header to render (a signal that React has hydrated).
  await page.waitForSelector('header h1', { timeout: 30_000 });

  // Expose editor + dispatcher on window so we can drive widget placement
  // from the page. We do this by importing from Vite's dev module graph.
  await page.evaluate(async () => {
    // Try a few attempts — Canvas may still be mounting on first call.
    const start = Date.now();
    while (Date.now() - start < 10_000) {
      try {
        const editorRef = await import('/src/state/editor-ref.ts');
        const dispatcherMod = await import('/src/canvas/dispatcher.ts');
        const editor = editorRef.getEditor();
        if (editor) {
          window.__opencanvasEditorForDemo__ = editor;
          window.__opencanvasDispatcher__ = dispatcherMod.applyToolDirective;
          return true;
        }
      } catch (e) {
        // module not ready yet
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('editor handle never appeared');
  });

  // ---- Storyboard ----
  await snap(page, 'empty canvas');

  // Fake-type into the chat composer for visual flair.
  const composer = await page.$('input[placeholder]');
  if (composer) {
    await composer.click();
    await composer.type('Compare REST vs gRPC', { delay: 40 });
  }
  await snap(page, 'chat with question');

  // Place a markdown widget (primary).
  await placeWidget(page, 'markdown', 'primary', {
    title: 'REST vs gRPC',
    body:
      '**REST** uses HTTP/1.1 + JSON. Human-readable, ubiquitous tooling, ' +
      'caches well. **gRPC** uses HTTP/2 + Protobuf. Smaller payloads, ' +
      'streaming bidirectionally, strong contract via .proto files.',
  });
  await new Promise((r) => setTimeout(r, FRAME_DELAY_MS));
  await snap(page, '+markdown');

  // Add a comparison table (detail).
  await placeWidget(page, 'table', 'detail', {
    title: 'Side-by-side',
    columns: [
      { key: 'aspect', label: 'Aspect' },
      { key: 'rest', label: 'REST' },
      { key: 'grpc', label: 'gRPC' },
    ],
    rows: [
      ['Wire format', 'JSON', 'Protobuf'],
      ['Transport', 'HTTP/1.1', 'HTTP/2'],
      ['Streaming', 'SSE / WebSocket', 'native bidi'],
      ['Browser', 'first-class', 'gRPC-Web'],
      ['Tooling', 'curl, Postman', 'protoc, Bloom'],
    ],
  });
  await new Promise((r) => setTimeout(r, FRAME_DELAY_MS));
  await snap(page, '+table');

  // Add a code block (related).
  await placeWidget(page, 'code-block', 'related', {
    title: 'gRPC service definition',
    language: 'proto',
    code:
      'service UserService {\n' +
      '  rpc GetUser(UserRequest) returns (User);\n' +
      '  rpc StreamUsers(Empty) returns (stream User);\n' +
      '}\n\n' +
      'message User {\n' +
      '  string id = 1;\n' +
      '  string name = 2;\n' +
      '  string email = 3;\n' +
      '}',
  });
  await new Promise((r) => setTimeout(r, FRAME_DELAY_MS));
  await snap(page, '+code');

  // Final "all placed" hold for an extra beat.
  await new Promise((r) => setTimeout(r, FRAME_DELAY_MS * 2));
  await snap(page, 'final');

  await browser.close();

  // ---- Stitch with ffmpeg-static ----
  console.log('[record-demo] stitching →', GIF_PATH);
  await new Promise((res, rej) => {
    const args = [
      '-y',
      '-framerate', '1.6', // ~600ms per frame
      '-i', join(OUT_DIR, 'frame-%03d.png'),
      '-vf', 'scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
      '-loop', '0',
      GIF_PATH,
    ];
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) =>
      code === 0 ? res(undefined) : rej(new Error(`ffmpeg exit ${code}`)),
    );
  });

  if (!existsSync(GIF_PATH)) throw new Error('demo.gif not produced');
  console.log('[record-demo] done →', GIF_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

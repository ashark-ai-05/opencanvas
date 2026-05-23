#!/usr/bin/env node
// Polished 60-80s marketing demo. Distinct from scripts/record-demo.mjs
// (which produces the lower-res GIF storyboard).
//
// Storyboard:
//   1. Hold on empty canvas with the hint banner (5s) — sets context.
//   2. User clicks into the chat input, types a question (5s) —
//      establishes the "agent-driven canvas" pitch.
//   3. Six widgets appear one at a time on a fixed 2×3 grid (12s).
//      Placed directly via the exposed tldraw editor at hand-picked
//      (x, y) page coords so the camera never has to move and nothing
//      drifts off-screen. Each widget renders at full size.
//   4. Cursor highlights two widgets in sequence — select/deselect
//      gesture (6s).
//   5. Slow-motion inertia pan as a polish beat, returns near center (6s).
//   6. Final hero shot of the populated canvas (4s).
//
// Conversion: WebM → MP4 (libx264 + faststart) via system ffmpeg.
//
// Requires `pnpm dev` running. Editor must be exposed on window via
// app/src/state/editor-ref.ts (dev-only setEditor side-effect).

import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync, statSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'http://127.0.0.1:3458';
const BACKEND = 'http://127.0.0.1:3457';
const VIDEO_DIR = '/tmp/opencanvas-demo-video';
const OUT_MP4 = join(ROOT, 'docs', 'demo.mp4');
const SIZE = { width: 1920, height: 1080 };

if (existsSync(VIDEO_DIR)) rmSync(VIDEO_DIR, { recursive: true });
mkdirSync(VIDEO_DIR, { recursive: true });

function tokenHeader() {
  const p = join(homedir(), '.opencanvas', 'auth-token');
  if (!existsSync(p)) return {};
  const t = readFileSync(p, 'utf8').trim();
  return t ? { 'X-OpenCanvas-Token': t } : {};
}

async function clearCanvas() {
  try {
    await fetch(`${BACKEND}/v1/canvas/clear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tokenHeader() },
    });
  } catch {
    /* tolerate auth/old-backend */
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[demo-mp4]', ...a);

log('clearing any previous demo state');
await clearCanvas();

log('launching browser at', SIZE);
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: SIZE,
  recordVideo: { dir: VIDEO_DIR, size: SIZE },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();
page.on('pageerror', (err) => log('PAGEERROR:', err.message));
page.on('console', (m) => {
  if (m.type() === 'error') log('CONSOLE-ERR:', m.text().slice(0, 200));
});

log('opening', APP);
await page.goto(APP, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.tl-canvas', { timeout: 20_000 });

// Wait for the editor to be exposed on window (dev-only hook). HMR may
// not have reloaded the page yet, so poll briefly.
log('waiting for editor singleton on window');
await page.waitForFunction(
  () => Boolean(window.__OPENCANVAS_EDITOR__),
  null,
  { timeout: 15_000 },
).catch(() => log('  WARN: editor not on window — will fall back to REST'));

// Force-reset camera so widget coords are predictable across runs.
await page.evaluate(() => {
  const ed = window.__OPENCANVAS_EDITOR__;
  if (ed) ed.setCamera({ x: 0, y: 0, z: 1 }, { immediate: true });
});

// Soft cursor overlay so viewers can follow page.mouse moves.
await page.addStyleTag({
  content: `
    .opencanvas-rec-cursor {
      position: fixed;
      top: 0; left: 0;
      width: 20px; height: 20px;
      margin: -10px 0 0 -10px;
      border-radius: 999px;
      background: rgba(167, 139, 250, 0.65);
      box-shadow:
        0 0 0 2px rgba(255,255,255,0.7),
        0 0 18px 6px rgba(167,139,250,0.55);
      pointer-events: none;
      z-index: 100000;
      transition: transform 0.05s linear;
    }
  `,
});
await page.evaluate(() => {
  const c = document.createElement('div');
  c.className = 'opencanvas-rec-cursor';
  c.style.left = '50%';
  c.style.top = '50%';
  document.body.appendChild(c);
  document.addEventListener(
    'mousemove',
    (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; },
    { capture: true },
  );
});

// === Helpers ===

// Place a widget by directly calling editor.createShape. This bypasses
// the backend layout function so we know the exact (x, y) where each
// widget lands. Page coords; with camera at (0, 0, 1) they map 1:1 to
// the visible canvas area below the header.
async function placeShape(type, x, y, w, h, props) {
  await page.evaluate(
    ({ type, x, y, w, h, props }) => {
      const ed = window.__OPENCANVAS_EDITOR__;
      if (!ed) throw new Error('editor not exposed on window');
      ed.createShape({ type, x, y, props: { w, h, ...props } });
    },
    { type, x, y, w, h, props },
  );
}

// === Beat 1: empty canvas hold (6s) ===
await page.mouse.move(SIZE.width / 2, SIZE.height / 2);
await wait(6000);

// === Beat 2: user types into the chat input (5s) ===
log('focusing chat input + typing');
// Move cursor toward the chat composer at bottom-right.
const composerXY = { x: 1530, y: 990 };
await page.mouse.move(composerXY.x, composerXY.y, { steps: 30 });
await wait(400);
// Click into the chat textarea
const composer = page.locator('textarea, [contenteditable="true"]').first();
await composer.click({ timeout: 5000 }).catch(() => null);
await wait(400);
const question = 'Build me a launch readiness board';
for (const ch of question) {
  await page.keyboard.type(ch);
  await wait(75); // ~one char every 75ms — feels like organic typing
}
await wait(2200);

// === Beat 3: widgets stream onto a fixed 2×3 grid (12s, ~2s/widget) ===
// Layout: column x = 80 / 580 / 1080, row y = 80 / 380
// Page coords. Camera is at (0,0,1) so these are also screen-pixel-ish
// offsets from canvas origin (which is below the 48px header).
log('placing widgets at fixed grid positions');

// 1. Markdown — hero card top-left
await placeShape('opencanvas:markdown', 60, 90, 460, 270, {
  title: 'OpenCanvas',
  body:
    '## Infinite canvas your LLM draws on\n\n' +
    'Typed widgets. Local-first. BYO model.\n\n' +
    '- 15 widget kinds + runtime plugins\n' +
    '- MCP-native\n' +
    '- SQLite + sqlite-vec KB',
  uri: 'demo://intro',
});
await wait(4000);

// 2. Table — top-middle
await placeShape('opencanvas:table', 550, 90, 460, 270, {
  title: 'LLM providers',
  columns: [
    { key: 'provider', label: 'Provider' },
    { key: 'auth',     label: 'Auth' },
    { key: 'local',    label: 'Local' },
  ],
  rows: [
    ['Claude (Agent SDK)', 'OAuth / API key', 'no'],
    ['OpenAI',             'API key',         'no'],
    ['OpenRouter',         'API key',         'no'],
    ['Ollama',             'none',            'yes'],
    ['Sourcegraph Amp',    'API key',         'no'],
  ],
});
await wait(4000);

// 3. Kanban — top-right
await placeShape('opencanvas:kanban', 1040, 90, 480, 270, {
  title: 'Launch readiness',
  columns: [
    { name: 'Doing', colour: 'amber',  cards: [
      { title: 'Record demo', tag: 'marketing' },
      { title: 'Draft launch post', tag: 'marketing' },
    ]},
    { name: 'Next',  colour: 'violet', cards: [
      { title: 'Signed installers', tag: 'platform', priority: 'high' },
      { title: 'Plugin gallery', tag: 'product' },
    ]},
    { name: 'Done',  colour: 'green',  cards: [
      { title: 'Token auth', tag: 'security' },
      { title: 'CSP + CORS', tag: 'security' },
      { title: 'Icon set + OG image', tag: 'marketing' },
    ]},
  ],
});
await wait(4000);

// 4. Code block — bottom-left.
// Schema uses `code` (not `body`) for the snippet.
await placeShape('opencanvas:code-block', 60, 400, 460, 230, {
  title: 'placeWidget',
  language: 'typescript',
  code:
    "// One agent tool call → one typed widget on the canvas.\n" +
    "await editor.placeWidget({\n" +
    "  kind: 'kanban',\n" +
    "  role: 'primary',\n" +
    "  payload: { title, columns: [...] },\n" +
    "});",
});
await wait(4000);

// 5. Sticky-note — bottom-middle
await placeShape('opencanvas:sticky-note', 550, 400, 460, 230, {
  body: 'Click, drag, pin, link, export — the widgets are real artifacts, not text.',
  author: 'OpenCanvas',
  colour: 'violet',
});
await wait(4000);

// 6. Time (pomodoro) — bottom-right
await placeShape('opencanvas:time', 1040, 400, 280, 230, {
  mode: 'pomodoro',
  label: 'Focus 25/5',
  startedAt: Date.now(),
  pomodoro: { workSec: 1500, breakSec: 300, longBreakEvery: 4 },
});
await wait(2500);

// === Beat 4: select then deselect a widget (6s) ===
log('selecting the markdown widget');
const mdCenter = { x: 290, y: 225 + 48 }; // 48 = header offset
await page.mouse.move(mdCenter.x, mdCenter.y, { steps: 25 });
await wait(400);
await page.mouse.click(mdCenter.x, mdCenter.y);
await wait(3500);

log('clicking empty to deselect');
const emptySpot = { x: 1500, y: 720 };
await page.mouse.move(emptySpot.x, emptySpot.y, { steps: 25 });
await wait(400);
await page.mouse.click(emptySpot.x, emptySpot.y);
await wait(2500);

// === Beat 5: slow-motion inertia pan (5s) ===
log('panning with slow-motion inertia');
const panStart = { x: 350, y: 750 };
await page.mouse.move(panStart.x, panStart.y, { steps: 20 });
await wait(300);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(panStart.x + i * 8, panStart.y - i * 6);
  await wait(10);
}
await page.mouse.up();
await wait(2200);

// Return camera to predictable home so the final shot is reproducible.
await page.evaluate(() => {
  const ed = window.__OPENCANVAS_EDITOR__;
  if (ed) ed.setCamera({ x: 0, y: 0, z: 1 }, { animation: { duration: 500 } });
});
await wait(900);

// === Beat 6: final hero shot (6s) ===
await page.mouse.move(SIZE.width / 2, SIZE.height / 2, { steps: 25 });
await wait(6000);

log('closing browser to flush video');
await page.close();
await ctx.close();
await browser.close();

const webms = readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm'));
if (webms.length === 0) throw new Error('Playwright did not write a video');
const webm = join(VIDEO_DIR, webms[0]);
log('captured', webm, '(' + statSync(webm).size + ' bytes)');

function resolveFfmpeg() {
  try {
    return execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
const ff = resolveFfmpeg();
if (!ff) throw new Error('no ffmpeg in PATH — install via brew');

log('converting → MP4 via', ff);
mkdirSync(dirname(OUT_MP4), { recursive: true });
execFileSync(
  ff,
  [
    '-y', '-i', webm,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    OUT_MP4,
  ],
  { stdio: ['ignore', 'inherit', 'inherit'] },
);

log('wrote', OUT_MP4, '(' + statSync(OUT_MP4).size + ' bytes)');
log('done');

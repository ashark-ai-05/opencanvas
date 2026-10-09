#!/usr/bin/env node
// README hero recorder. Produces docs/demo.mp4 + docs/demo.gif (a ~16 s loop),
// or, with --gallery, docs/widgets.png (a 3x2 widget kind gallery).
//
//   pnpm dev                                  # in another terminal
//   node scripts/record-demo-mp4.mjs          # hero mp4 + gif
//   node scripts/record-demo-mp4.mjs --gallery
//
// Hero storyboard (camera fixed at 0,0,1, viewport 1440x810):
//   1. Open on the FINISHED canvas (chart + table + kanban, prompt in the
//      composer) and hold 2 s. This is the first frame GitHub shows.
//   2. Clear the canvas, type "Compare our three launch options" (3 s).
//   3. Widgets land one at a time, 2 s apart.
//   4. A soft cursor drags the table into place and drops it (2 s).
//   5. Hold the final hero 3 s. The final state equals the opening state,
//      so the loop is seamless.
//
// Widgets are POSTed through the REST route (it performs the plugin rewrite
// that makes the Vega-Lite chart render) and then moved/resized through the
// dev-only window.__OPENCANVAS_EDITOR__ hook so layout is deterministic.

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
const GALLERY_DIR = '/tmp/opencanvas-gallery';
const OUT_MP4 = join(ROOT, 'docs', 'demo.mp4');
const OUT_GIF = join(ROOT, 'docs', 'demo.gif');
const OUT_GALLERY = join(ROOT, 'docs', 'widgets.png');
const SIZE = { width: 1440, height: 810 };
const GALLERY = process.argv.includes('--gallery');
const PROMPT = 'Compare our three launch options';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[demo]', ...a);
const ffmpeg = () => execFileSync('which', ['ffmpeg'], { encoding: 'utf8' }).trim();

function tokenHeader() {
  const p = join(homedir(), '.opencanvas', 'auth-token');
  if (!existsSync(p)) return {};
  const t = readFileSync(p, 'utf8').trim();
  return t ? { 'X-OpenCanvas-Token': t } : {};
}

async function api(path, body) {
  const res = await fetch(BACKEND + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tokenHeader() },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(`POST ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

// ---------------------------------------------------------------- widgets
const CHART = {
  kind: 'chart',
  role: 'primary',
  payload: {
    title: 'Projected signups, first 90 days',
    spec: {
      data: {
        values: [
          { option: 'A: Open beta', signups: 4200 },
          { option: 'B: Product Hunt', signups: 6900 },
          { option: 'C: Partner launch', signups: 3100 },
        ],
      },
      width: 'container',
      height: 'container',
      // Explicit dark paint: the sandboxed iframe canvas is otherwise opaque white.
      background: '#13131b',
      mark: { type: 'bar', cornerRadiusEnd: 4, color: '#a78bfa' },
      encoding: {
        x: { field: 'option', type: 'nominal', axis: { labelAngle: 0, title: null } },
        y: { field: 'signups', type: 'quantitative', axis: { title: null } },
      },
    },
  },
};
const TABLE = {
  kind: 'table',
  role: 'detail',
  payload: {
    title: 'Launch options',
    columns: [
      { key: 'option', label: 'Option' },
      { key: 'cost', label: 'Cost', align: 'right', mono: true },
      { key: 'reach', label: 'Reach', align: 'right', mono: true },
      { key: 'risk', label: 'Risk' },
    ],
    rows: [
      ['A: Open beta', '$2k', '4.2k', 'Low'],
      ['B: Product Hunt', '$5k', '6.9k', 'Medium'],
      ['C: Partner launch', '$12k', '3.1k', 'Low'],
    ],
  },
};
const KANBAN = {
  kind: 'kanban',
  role: 'related',
  payload: {
    title: 'Launch plan',
    columns: [
      { name: 'Doing', colour: 'amber', cards: [{ title: 'Write launch post', tag: 'content' }] },
      { name: 'Next', colour: 'violet', cards: [{ title: 'Line up partners', tag: 'bd', priority: 'high' }] },
      { name: 'Done', colour: 'green', cards: [{ title: 'Pick launch date', tag: 'ops' }] },
    ],
  },
};

// Gallery extras. Each is shown alone at 600x380 CSS px.
const TIMER = {
  kind: 'time',
  role: 'detail',
  payload: {
    mode: 'pomodoro',
    label: 'Deep work 25/5',
    startedAt: Date.now() - 7 * 60_000 - 42_000,
    elapsedAtPause: 0,
    paused: false,
    pomodoro: { workSec: 1500, breakSec: 300, longBreakSec: 900, longBreakEvery: 4, sessions: 2, phase: 'work' },
  },
};
const CODE = {
  kind: 'code-block',
  role: 'detail',
  payload: {
    title: 'retry.ts',
    language: 'typescript',
    code:
      'export async function withRetry<T>(\n' +
      '  fn: () => Promise<T>,\n' +
      '  attempts = 4,\n' +
      '): Promise<T> {\n' +
      '  let delay = 200;\n' +
      '  for (let i = 1; ; i++) {\n' +
      '    try {\n' +
      '      return await fn();\n' +
      '    } catch (err) {\n' +
      '      if (i >= attempts) throw err;\n' +
      '      await new Promise((r) => setTimeout(r, delay));\n' +
      '      delay *= 2; // exponential backoff\n' +
      '    }\n' +
      '  }\n' +
      '}',
  },
};
const HTML = {
  kind: 'html',
  role: 'detail',
  payload: {
    title: 'Sandboxed HTML',
    html:
      '<body style="margin:0;font-family:system-ui;background:#14141c;color:#e7e5f4;display:grid;place-items:center;height:100vh">' +
      '<div style="text-align:center"><div style="font-size:13px;letter-spacing:.12em;color:#a78bfa;text-transform:uppercase">Uptime, last 30 days</div>' +
      '<div style="font-size:64px;font-weight:700;margin:6px 0">99.97%</div>' +
      '<div style="display:flex;gap:3px;justify-content:center">' +
      Array.from({ length: 30 }, (_, i) => `<span style="width:8px;height:34px;border-radius:2px;background:${i === 11 ? '#fbbf24' : '#2dd4bf'}"></span>`).join('') +
      '</div><div style="margin-top:10px;font-size:13px;color:#8b89a0">1 degraded day, 0 outages</div></div></body>',
  },
};

// ---------------------------------------------------------------- browser
const browser = await chromium.launch();

async function openPage(extra = {}) {
  const ctx = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    ...extra,
  });
  // Skip the first-run tour so it does not cover the canvas.
  await ctx.addInitScript(() => {
    try { localStorage.setItem('opencanvas:onboarding-tour:v1', '1'); } catch { /* ignore */ }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => log('PAGEERROR:', err.message));
  const createdAt = Date.now();
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tl-canvas', { timeout: 20_000 });
  await page.waitForFunction(() => Boolean(window.__OPENCANVAS_EDITOR__), null, { timeout: 15_000 });
  await wait(2500); // SSE handshake so REST placements reach this tab
  for (let i = 0; i < 5; i++) {
    try {
      await page.waitForFunction(() => Boolean(window.__OPENCANVAS_EDITOR__), null, { timeout: 15_000 });
      await page.evaluate(() => { window.__OPENCANVAS_EDITOR__.setCamera({ x: 0, y: 0, z: 1 }, { immediate: true }); });
      break;
    } catch (e) {
      log('setup retry', e.message.split('\n')[0]);
      await wait(2000);
    }
  }
  return { ctx, page, createdAt };
}

async function clearCanvas(page) {
  await api('/v1/canvas/clear');
  await page.waitForFunction(
    () => window.__OPENCANVAS_EDITOR__.getCurrentPageShapes().filter((s) => s.type.startsWith('opencanvas:')).length === 0,
    null, { timeout: 8000 },
  );
}

const shapeIds = (page) =>
  page.evaluate(() => window.__OPENCANVAS_EDITOR__.getCurrentPageShapes().filter((s) => s.type.startsWith('opencanvas:')).map((s) => s.id));

// POST a widget, wait for its shape to appear, then pin it at (x,y,w,h).
async function place(page, widget, box) {
  const before = new Set(await shapeIds(page));
  await api('/v1/canvas/widgets', widget);
  await page.waitForFunction(
    (b) => window.__OPENCANVAS_EDITOR__.getCurrentPageShapes().some((s) => s.type.startsWith('opencanvas:') && !b.includes(s.id)),
    [...before], { timeout: 8000 },
  );
  const id = (await shapeIds(page)).find((i) => !before.has(i));
  await pin(page, id, box);
  return id;
}

async function pin(page, id, { x, y, w, h }) {
  await page.evaluate(({ id, x, y, w, h }) => {
    const ed = window.__OPENCANVAS_EDITOR__;
    const s = ed.getShape(id);
    ed.updateShape({ id, type: s.type, x, y, props: { ...s.props, w, h }, meta: { ...(s.meta ?? {}), collapsed: false } });
  }, { id, x, y, w, h });
}

// Re-pin repeatedly for a short while: the dispatcher's auto-tidy can reflow
// a burst ~700 ms after the last placement.
async function pinFor(page, entries, ms = 1800) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const [id, box] of entries) await pin(page, id, box);
    await wait(150);
  }
}

async function setComposer(page, text) {
  await page.evaluate((t) => {
    const el = document.querySelector('.opencanvas-chat-input');
    if (!(el instanceof HTMLTextAreaElement)) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, t);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

async function injectCursor(page) {
  await page.addStyleTag({
    content: `.opencanvas-rec-cursor{position:fixed;top:0;left:0;width:20px;height:20px;margin:-10px 0 0 -10px;
      border-radius:999px;background:rgba(167,139,250,.65);box-shadow:0 0 0 2px rgba(255,255,255,.7),0 0 18px 6px rgba(167,139,250,.55);
      pointer-events:none;z-index:100000;opacity:0;transition:opacity .2s}`,
  });
  await page.evaluate(() => {
    const c = document.createElement('div');
    c.className = 'opencanvas-rec-cursor';
    document.body.appendChild(c);
    document.addEventListener('mousemove', (e) => {
      c.style.opacity = '1';
      c.style.left = e.clientX + 'px';
      c.style.top = e.clientY + 'px';
    }, { capture: true });
  });
}

// ---------------------------------------------------------------- gallery
async function runGallery() {
  if (existsSync(GALLERY_DIR)) rmSync(GALLERY_DIR, { recursive: true });
  mkdirSync(GALLERY_DIR, { recursive: true });
  const { ctx, page } = await openPage({ deviceScaleFactor: 2 });
  await page.evaluate(() => import('/src/state/ui-store.ts').then((m) => { m.useUiStore.getState().setChatWindow({ mode: 'collapsed' }); }));
  await clearCanvas(page);

  const W = 600, H = 380;
  const items = [
    ['chart', CHART], ['kanban', KANBAN], ['table', TABLE],
    ['timer', TIMER], ['code', CODE], ['html', HTML],
  ];
  const files = [];
  for (const [name, widget] of items) {
    await clearCanvas(page);
    const id = await place(page, widget, { x: 120, y: 160, w: W, h: H });
    await pinFor(page, [[id, { x: 120, y: 160, w: W, h: H }]], 2600);
    await page.mouse.move(5, 5);
    const clip = await page.evaluate((id) => {
      const ed = window.__OPENCANVAS_EDITOR__;
      const b = ed.getShapePageBounds(id);
      const p = ed.pageToScreen({ x: b.x, y: b.y });
      return { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(b.w), height: Math.round(b.h) };
    }, id);
    const file = join(GALLERY_DIR, `${name}.png`);
    await page.screenshot({ path: file, clip });
    files.push(file);
    log('captured', name, JSON.stringify(clip));
  }
  await ctx.close();
  await browser.close();

  const ff = ffmpeg();
  const G = 24;
  const tw = W * 2 + G, th = H * 2 + G; // tile incl. left/top gutter
  const inputs = files.flatMap((f) => ['-i', f]);
  const pads = files.map((_, i) => `[${i}:v]pad=${tw}:${th}:${G}:${G}:color=0x0b0b10[t${i}]`).join(';');
  const layout = ['0_0', `${tw}_0`, `${tw * 2}_0`, `0_${th}`, `${tw}_${th}`, `${tw * 2}_${th}`].join('|');
  const filter =
    `${pads};${files.map((_, i) => `[t${i}]`).join('')}xstack=inputs=6:layout=${layout}:fill=0x0b0b10[x];` +
    `[x]pad=iw+${G}:ih+${G}:0:0:color=0x0b0b10,scale=1920:-1:flags=lanczos`;
  execFileSync(ff, ['-y', ...inputs, '-filter_complex', filter, '-frames:v', '1', OUT_GALLERY], { stdio: 'inherit' });
  log('wrote', OUT_GALLERY, statSync(OUT_GALLERY).size, 'bytes');
}

// ---------------------------------------------------------------- hero
// Layout: three columns across the canvas area, chat shrunk below them.
const COL_Y = 100, COL_H = 340, GAP = 20, X0 = 20;
const BOX = {
  chart: { x: X0, y: COL_Y, w: 420, h: COL_H },
  table: { x: X0 + 420 + GAP, y: COL_Y, w: 420, h: COL_H },
  kanban: { x: X0 + 2 * (420 + GAP), y: COL_Y, w: 520, h: COL_H },
};
const TABLE_START = { ...BOX.table, y: BOX.table.y + 44 }; // dragged up into place

async function runHero() {
  if (existsSync(VIDEO_DIR)) rmSync(VIDEO_DIR, { recursive: true });
  mkdirSync(VIDEO_DIR, { recursive: true });
  const { ctx, page, createdAt } = await openPage({ recordVideo: { dir: VIDEO_DIR, size: SIZE } });
  await injectCursor(page);
  // Keep the camera pinned at 0,0,1: tldraw nudges it while dragging and the
  // opening and closing frames must line up exactly for a seamless loop.
  await page.evaluate(() => {
    const ed = window.__OPENCANVAS_EDITOR__;
    setInterval(() => {
      const c = ed.getCamera();
      if (c.x !== 0 || c.y !== 0 || c.z !== 1) ed.setCamera({ x: 0, y: 0, z: 1 }, { immediate: true });
    }, 50);
  });
  // Shrink the floating chat so it sits under the widget columns instead of
  // covering them (recording-only style; the product CSS is untouched).
  await page.addStyleTag({
    content: `aside[data-mode="open"]{height:250px !important;max-height:250px !important}
      [data-sonner-toaster]{display:none !important}`,
  });
  await clearCanvas(page);

  // Finished state first (also the state we loop back to).
  const ids = {};
  ids.chart = await place(page, CHART, BOX.chart);
  ids.table = await place(page, TABLE, BOX.table);
  ids.kanban = await place(page, KANBAN, BOX.kanban);
  await pinFor(page, Object.entries(ids).map(([k, id]) => [id, BOX[k]]), 2200);
  await setComposer(page, PROMPT);
  await wait(500);

  const readyAt = Date.now();
  log('opening state ready; holding 2s');
  await wait(2000);

  // 2. clear + type the prompt
  await clearCanvas(page);
  await setComposer(page, '');
  await wait(300);
  const input = page.locator('.opencanvas-chat-input');
  await input.click();
  for (const ch of PROMPT) {
    await page.keyboard.type(ch);
    await wait(70);
  }
  await wait(300);

  // 3. widgets land, 2 s apart
  const land = async (key, widget, box) => {
    ids[key] = await place(page, widget, box);
    await pinFor(page, [[ids[key], box]], 1200);
  };
  await land('chart', CHART, BOX.chart);
  await wait(500);
  await land('table', TABLE, TABLE_START);
  await wait(500);
  await land('kanban', KANBAN, BOX.kanban);
  await wait(500);

  // 4. cursor drags the table into its final slot
  const origin = await page.evaluate(() => window.__OPENCANVAS_EDITOR__.pageToScreen({ x: 0, y: 0 }));
  const from = { x: origin.x + TABLE_START.x + BOX.table.w / 2 + 60, y: origin.y + TABLE_START.y + 22 };
  const to = { x: from.x, y: from.y - 44 };
  await page.mouse.move(from.x, from.y, { steps: 25 });
  await wait(250);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 30 });
  await page.mouse.up();
  await wait(300);
  await page.mouse.move(820, 120, { steps: 20 });
  await page.evaluate(() => { document.querySelector('.opencanvas-rec-cursor').style.opacity = '0'; });
  // make sure it ended exactly in the canonical slot, deselected
  await pin(page, ids.table, BOX.table);
  await page.evaluate(() => { window.__OPENCANVAS_EDITOR__.selectNone(); });
  await wait(500);

  // 5. final hold
  await wait(3000);
  const endAt = Date.now();

  const video = page.video();
  await page.close();
  await ctx.close();
  await browser.close();
  const webm = await video.path();
  log('captured', webm, statSync(webm).size, 'bytes');

  // Trim the page-load lead-in; the video clock starts at page creation.
  const ss = ((readyAt - createdAt) / 1000).toFixed(2);
  const dur = ((endAt - readyAt) / 1000).toFixed(2);
  log(`trim start ${ss}s duration ${dur}s`);
  const ff = ffmpeg();
  mkdirSync(dirname(OUT_MP4), { recursive: true });
  execFileSync(ff, [
    '-y', '-ss', ss, '-i', webm, '-t', dur,
    '-vf', `scale=${SIZE.width}:${SIZE.height}:flags=lanczos,fps=30`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    OUT_MP4,
  ], { stdio: 'inherit' });

  const palette = '/tmp/opencanvas-demo-palette.png';
  let gifFps = 10;
  for (const fps of [10, 8]) {
    gifFps = fps;
    const vf = `fps=${fps},scale=960:-1:flags=lanczos`;
    execFileSync(ff, ['-y', '-i', OUT_MP4, '-vf', `${vf},palettegen=stats_mode=diff`, palette], { stdio: 'inherit' });
    execFileSync(ff, ['-y', '-i', OUT_MP4, '-i', palette, '-lavfi', `${vf}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`, '-loop', '0', OUT_GIF], { stdio: 'inherit' });
    if (statSync(OUT_GIF).size < 4 * 1024 * 1024) break;
    log(`gif ${statSync(OUT_GIF).size} bytes at ${fps} fps; retrying lower`);
  }
  log(`mp4 ${statSync(OUT_MP4).size} bytes, gif ${statSync(OUT_GIF).size} bytes @ ${gifFps} fps`);
}

if (GALLERY) await runGallery();
else await runHero();
log('done');

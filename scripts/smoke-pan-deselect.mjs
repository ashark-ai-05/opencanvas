// One-shot smoke test for the v0.1.0 polish: pan inertia, click-deselect,
// select-on-widget. Assumes pnpm dev is running (backend :3457, vite :3458).
// Usage: pnpm tsx scripts/smoke-pan-deselect.mjs

import { chromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const APP = 'http://127.0.0.1:3458';
const BACKEND = 'http://127.0.0.1:3457';
const OUT = '/tmp/opencanvas-smoke';
mkdirSync(OUT, { recursive: true });

function tokenHeader() {
  const p = join(homedir(), '.opencanvas', 'auth-token');
  if (!existsSync(p)) return {};
  const t = readFileSync(p, 'utf8').trim();
  return t ? { 'X-OpenCanvas-Token': t } : {};
}

async function placeWidget() {
  const r = await fetch(`${BACKEND}/v1/canvas/widgets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tokenHeader() },
    body: JSON.stringify({
      kind: 'markdown',
      role: 'primary',
      payload: {
        title: 'Smoke test widget',
        body: '# Click me\n\nThis widget exists to verify select/deselect.',
        uri: 'smoke://test',
      },
    }),
  });
  if (!r.ok) {
    console.error(`POST /v1/canvas/widgets → ${r.status} ${await r.text()}`);
    return null;
  }
  return r.json();
}

const log = (...a) => console.log('[smoke]', ...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 900 },
});
const page = await ctx.newPage();
page.on('pageerror', (err) => log('PAGEERROR:', err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') log('CONSOLE:', msg.text());
});

log('opening', APP);
await page.goto(APP, { waitUntil: 'domcontentloaded' });
// Wait for tldraw to mount.
await page.waitForSelector('.tl-canvas', { timeout: 15_000 });
log('app loaded');
await page.screenshot({ path: `${OUT}/01-loaded.png` });

log('placing widget via REST');
const placed = await placeWidget();
log('placed:', placed ? JSON.stringify(placed).slice(0, 200) : 'failed');
await page.waitForTimeout(1500); // let stream + render settle
await page.screenshot({ path: `${OUT}/02-widget-placed.png` });

// Find the widget's actual bounding box on screen so we can click ON
// it precisely, and choose an "empty" area far away from it.
async function widgetBox() {
  return await page.evaluate(() => {
    // tldraw shapes are rendered inside .tl-shape elements (one per shape).
    // We placed a single opencanvas:markdown widget; grab its rect.
    const el = document.querySelector('.tl-shape');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

const widget = await widgetBox();
log('widget rect:', widget);
if (!widget) throw new Error('widget DOM not found');

const canvasBox = await page.locator('.tl-canvas').boundingBox();
if (!canvasBox) throw new Error('canvas not found');

// Pick an empty point: far-right side of the canvas, well clear of the
// widget AND the chat panel on the right (we'll target the open space
// in the middle-top, around (700, 150)).
const empty = { x: 700, y: 150 };

// tldraw camera transform is on .tl-svg-container's child <g>. Probe
// inline-styled `transform` on the shapes container.
async function camera() {
  return await page.evaluate(() => {
    // tldraw v3: camera applies to a wrapper. Check the first `.tl-svg-container`
    // child group's transform attr OR the inline transform on `.tl-canvas`.
    const g =
      document.querySelector('.tl-svg-container > g[transform]') ??
      document.querySelector('[data-testid="canvas"]') ??
      document.querySelector('.tl-canvas');
    if (!g) return null;
    return g.getAttribute('transform') ?? getComputedStyle(g).transform;
  });
}

// 1. Click ON the widget — expect tldraw to select it (blue ring).
log('click widget center at', widget.x + widget.w / 2, widget.y + widget.h / 2);
await page.mouse.click(widget.x + widget.w / 2, widget.y + widget.h / 2);
await page.waitForTimeout(300);
const selectedAfterWidgetClick = await page.evaluate(() =>
  document.querySelectorAll('[data-shape-type], .tl-selection__fg, .tl-overlays__item').length > 0
    ? !!document.querySelector('.tl-selection__fg, [data-shape-type=opencanvas\\:markdown].tl-selected')
    : false,
);
await page.screenshot({ path: `${OUT}/03-after-widget-click.png` });

// 2. Click far from widget — expect deselect.
log('click empty area at', empty.x, empty.y);
await page.mouse.click(empty.x, empty.y);
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/04-after-empty-click.png` });

// 3. Pan: drag from the empty area (not on the widget!) and observe
//    that the camera moves AND continues briefly after release.
const camBefore = await camera();
log('camera before pan:', camBefore);

const panStart = { x: 900, y: 200 };
log('starting pan drag from', panStart);
await page.mouse.move(panStart.x, panStart.y);
await page.mouse.down();
for (let i = 1; i <= 20; i++) {
  await page.mouse.move(panStart.x + i * 12, panStart.y + i * 6);
  await page.waitForTimeout(8);
}
await page.screenshot({ path: `${OUT}/05-mid-pan.png` });
const camAtRelease = await camera();
log('camera at release:', camAtRelease);
log('releasing pan');
await page.mouse.up();

await page.waitForTimeout(150);
const camMidInertia = await camera();
log('camera mid-inertia (150ms after release):', camMidInertia);
await page.screenshot({ path: `${OUT}/06-mid-inertia.png` });

await page.waitForTimeout(1500);
const camAfterGlide = await camera();
log('camera after glide:', camAfterGlide);
await page.screenshot({ path: `${OUT}/07-after-glide.png` });

log('--- results ---');
log('  pan moved camera during drag:', camBefore !== camAtRelease ? 'OK' : 'FAIL');
log('  inertia continued after release:', camAtRelease !== camMidInertia ? 'OK' : 'FAIL (no glide)');
log('  inertia eventually stopped:    ', camMidInertia !== camAfterGlide ? 'still drifting' : 'OK stopped');
log('screenshots:', OUT);

await browser.close();

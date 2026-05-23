#!/usr/bin/env node
/**
 * Record the README hero GIF — the "Q3 Operations Dashboard" demo.
 *
 * Storyboard: a user types "render something amazing on canvas." The
 * canvas explodes into a coherent dashboard: a hero markdown brief,
 * a Vega-Lite chart, a live pomodoro + two timezone clocks, a region
 * health table, a Q3 kanban, a decisions timeline, a sandboxed web
 * embed, a weekly KV summary, and a sticky note. Auto-tidy reflows
 * the burst into role slots and we hold the hero shot for a few
 * frames so the role-tinted card auras + the live chart can read.
 *
 * Pipeline:
 *   1. Boot Playwright's bundled chromium (headless, dark scheme).
 *   2. Navigate to the running Vite dev server (:3458).
 *   3. POST widgets to /v1/canvas/widgets — the browser's SSE
 *      subscriber renders them as they arrive. This route handles
 *      the plugin rewrite (chart → kind:'plugin'), so the demo's
 *      Vega-Lite chart shows up correctly without a window-hook
 *      detour through applyToolDirective.
 *   4. Snap PNGs at 1280×800 @ 1.5x DPR with deliberate beats.
 *   5. Stitch with ffmpeg-static into docs/demo.gif at 4 fps.
 *
 * Run:
 *   pnpm dev                              # in another terminal
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
const BACKEND = 'http://127.0.0.1:3457';
const FFMPEG = (await import('ffmpeg-static')).default;
const W = 1280;
const H = 800;
const FPS = 5;        // playback rate of the gif (one frame every 200ms)
const HOLD = 260;     // ms between snaps within a beat
const POP = 520;      // a placement settling beat
const HERO = 900;     // hero / pause beats
const NOW_MS = Date.now();

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
  console.log(`[demo] frame ${frameNo}: ${label}`);
  return file;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postWidget(payload) {
  const res = await fetch(BACKEND + '/v1/canvas/widgets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`POST /v1/canvas/widgets ${res.status}: ${body}`);
  }
  return res.json();
}

async function clearCanvas(conversationId) {
  const res = await fetch(BACKEND + '/v1/canvas/clear', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId }),
  });
  // Tolerate failure when there's no active conversation yet — the
  // initial burst will still land via the active-conversation handshake
  // the browser fires on mount.
  if (!res.ok) console.warn('[demo] clear-canvas failed:', res.status);
}

// ─────────────────────────────────────────────────────────────────────
// Storyboard widgets — the Q3 Operations Dashboard.
// Roles drive the auto-tidy slot resolver: primary on top, detail in
// the second band, related in the third, timeline below, reference
// to one side, node items final.
// ─────────────────────────────────────────────────────────────────────
const WIDGETS = [
  {
    label: 'hero markdown',
    body: {
      kind: 'markdown', role: 'primary',
      payload: {
        title: 'Q3 Operations Dashboard',
        body:
          '## Welcome back\n\n' +
          'Six countries, eleven product lines, one canvas.\n\n' +
          '**Today\'s themes**\n' +
          '- 🚀 EU launch is **3 weeks out** — go/no-go review Friday\n' +
          '- 📈 MAU growth **+18% MoM** — best month in a year\n' +
          '- ⚠️ Latency creeping in `ap-south` — eng investigating',
      },
    },
  },
  {
    label: 'live MAU chart (Vega-Lite plugin)',
    body: {
      kind: 'chart', role: 'primary',
      payload: {
        title: 'Monthly Active Users — last 8 months',
        spec: {
          data: { values: [
            { month: 'Jan', users: 1200, target: 1500 },
            { month: 'Feb', users: 1450, target: 1700 },
            { month: 'Mar', users: 1820, target: 1900 },
            { month: 'Apr', users: 2100, target: 2200 },
            { month: 'May', users: 2480, target: 2600 },
            { month: 'Jun', users: 2950, target: 2900 },
            { month: 'Jul', users: 3420, target: 3300 },
            { month: 'Aug', users: 4100, target: 3800 },
          ]},
          layer: [
            { mark: { type: 'area', opacity: 0.18, color: '#a78bfa' },
              encoding: { x: { field: 'month', type: 'ordinal' },
                          y: { field: 'users', type: 'quantitative' } } },
            { mark: { type: 'line', strokeWidth: 3, point: true, tooltip: true },
              encoding: { x: { field: 'month', type: 'ordinal',
                               axis: { labelAngle: 0, title: null } },
                          y: { field: 'users', type: 'quantitative',
                               axis: { title: 'MAU' } } } },
            { mark: { type: 'line', strokeDash: [4, 4],
                      color: '#71717a', tooltip: true },
              encoding: { x: { field: 'month', type: 'ordinal' },
                          y: { field: 'target', type: 'quantitative' } } },
          ],
        },
      },
    },
  },
  {
    label: 'pomodoro (live)',
    body: {
      kind: 'time', role: 'detail',
      payload: {
        mode: 'pomodoro', label: 'Deep work · 25/5',
        startedAt: NOW_MS, elapsedAtPause: 0, paused: false,
        pomodoro: { workSec: 1500, breakSec: 300, longBreakSec: 900,
                    longBreakEvery: 4, sessions: 0, phase: 'work' },
      },
    },
  },
  {
    label: 'SF clock (live)',
    body: {
      kind: 'time', role: 'detail',
      payload: { mode: 'clock', label: 'San Francisco',
                 tz: 'America/Los_Angeles', format: '12h' },
    },
  },
  {
    label: 'Tokyo clock (live)',
    body: {
      kind: 'time', role: 'detail',
      payload: { mode: 'clock', label: 'Tokyo',
                 tz: 'Asia/Tokyo', format: '24h' },
    },
  },
  {
    label: 'region health table',
    body: {
      kind: 'table', role: 'related',
      payload: {
        title: 'Region health · last 24h',
        columns: [
          { key: 'region', label: 'Region' },
          { key: 'rps',    label: 'RPS',    align: 'right', mono: true },
          { key: 'p95',    label: 'p95 ms', align: 'right', mono: true },
          { key: 'uptime', label: 'Uptime', align: 'right', mono: true },
          { key: 'trend',  label: 'Trend' },
        ],
        rows: [
          ['us-east',    '4,200', ' 22', '99.99%', '↗ steady'],
          ['us-west',    '3,400', ' 18', '99.98%', '↗ steady'],
          ['eu-west',    '2,800', ' 31', '99.95%', '→ flat'],
          ['eu-central', '2,950', ' 28', '99.97%', '↗ steady'],
          ['ap-south',   '1,900', ' 47', '99.82%', '↘ degrading'],
          ['ap-east',    '1,700', ' 52', '99.79%', '↘ degrading'],
          ['sa-east',    '1,300', ' 64', '99.68%', '→ flat'],
        ],
      },
    },
  },
  {
    label: 'Q3 kanban',
    body: {
      kind: 'kanban', role: 'related',
      payload: {
        title: 'Q3 deliverables',
        columns: [
          { name: 'Backlog', colour: 'neutral', cards: [
            { title: 'Mobile push for EU launch', tag: 'growth', priority: 'med' },
            { title: 'Refresh pricing page', tag: 'marketing' },
          ]},
          { name: 'In progress', colour: 'amber', cards: [
            { title: 'Latency: ap-south remediation', tag: 'infra',
              assignee: 'Priya', priority: 'high' },
            { title: 'Onboarding rewrite (v3)', tag: 'growth', assignee: 'Marc' },
          ]},
          { name: 'Review', colour: 'violet', cards: [
            { title: 'EU launch — go/no-go', tag: 'launch',
              assignee: 'Anya', priority: 'high' },
          ]},
          { name: 'Shipped', colour: 'green', cards: [
            { title: 'SAML SSO', tag: 'compliance', assignee: 'Priya' },
            { title: 'Activity timeline', tag: 'product' },
          ]},
        ],
      },
    },
  },
  {
    label: 'decisions timeline',
    body: {
      kind: 'timeline', role: 'timeline',
      payload: {
        title: 'Recent decisions',
        events: [
          { timestamp: '2026-04-18',
            label: 'Approved EU data residency plan', kind: 'release' },
          { timestamp: '2026-04-22',
            label: 'Tracing rollout (us-east)', kind: 'deploy' },
          { timestamp: '2026-04-29',
            label: 'ap-south latency incident', kind: 'incident',
            body: 'p95 spiked to 180ms for 2h.' },
          { timestamp: '2026-05-02',
            label: 'Hired SRE lead', kind: 'note' },
          { timestamp: '2026-05-05',
            label: 'v3 onboarding flow merged', kind: 'commit' },
        ],
      },
    },
  },
  {
    label: 'KV summary',
    body: {
      kind: 'key-value-card', role: 'node',
      payload: {
        title: 'This week at a glance',
        fields: [
          { key: 'MAU',            value: '4,128 (+18%)' },
          { key: 'Revenue',        value: '$284K (+12%)' },
          { key: 'p95 (global)',   value: '29 ms' },
          { key: 'Open incidents', value: '1 (P3, ap-south)' },
          { key: 'Releases',       value: '7 this week' },
        ],
      },
    },
  },
  {
    label: 'sticky note',
    body: {
      kind: 'sticky-note', role: 'node',
      payload: {
        body: 'Make the EU launch boring 🚢\n\n— a calm launch is a successful launch',
        author: 'Anya', colour: 'violet',
      },
    },
  },
];

async function main() {
  await ensureCleanFrames();

  console.log('[demo] launching chromium');
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1.5,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('[page-error]', e.message));

  console.log('[demo] navigate', APP_URL);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('header h1', { timeout: 30_000 });

  // Wait for the canvas SSE handshake so subsequent /v1/canvas/widgets
  // POSTs land in this browser session. The hook fires on mount; we
  // give it ~1s to register the conversationId with the backend.
  await sleep(1200);

  // Pull the active conversationId out of the conversations store so
  // we can scope the clear precisely (avoids touching whatever else
  // the user's OpenCanvas instance had open).
  const activeId = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 5000) {
      try {
        const m = await import('/src/state/conversations-store.ts');
        const id = m.useConversationsStore.getState().activeId;
        if (id) return id;
      } catch { /* not ready yet */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    return null;
  });
  if (activeId) await clearCanvas(activeId);
  await sleep(400);

  // ── Beat 1 — empty canvas hero ──────────────────────────────────
  await snap(page, 'empty canvas');
  await sleep(HOLD);
  await snap(page, 'empty canvas (hold)');

  // ── Beat 2 — type the prompt slowly ─────────────────────────────
  const input = await page.$('.opencanvas-chat-input');
  if (input) {
    await input.focus();
    await sleep(HOLD);
    await snap(page, 'composer focused');
    const text = 'render something amazing on canvas';
    let buffer = '';
    for (let i = 0; i < text.length; i++) {
      buffer += text[i];
      await input.type(text[i], { delay: 0 });
      // Snap roughly every word for a perceptibly-slow typing animation.
      if ((i + 1) % 6 === 0 || i === text.length - 1) {
        await sleep(140);
        await snap(page, `typing "${buffer}"`);
      }
    }
    await sleep(HOLD);

    // "Submit" — clear the textarea via the React-aware setter.
    await page.evaluate(() => {
      const el = document.querySelector('.opencanvas-chat-input');
      if (!(el instanceof HTMLTextAreaElement)) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value',
      )?.set;
      setter?.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(HOLD);
    await snap(page, 'submitted');
  }

  // ── Beat 3 — collapse chat → canvas as hero ─────────────────────
  await page.evaluate(() => {
    return import('/src/state/ui-store.ts').then((m) => {
      m.useUiStore.getState().setChatWindow({ mode: 'collapsed' });
    });
  });
  await sleep(HOLD);
  await snap(page, 'chat collapsed');

  // ── Beat 4 — sequential widget burst ────────────────────────────
  // POST each widget; snap once after the SSE round-trip lands and
  // again after the role-aura settle. The dispatcher's auto-tidy
  // debounces 700ms after the last placement so a final burst-end
  // beat captures the rearrangement.
  for (const w of WIDGETS) {
    await postWidget(w.body);
    await sleep(180);                // SSE round-trip + dispatcher
    await snap(page, `+ ${w.label} (pop)`);
    await sleep(POP - 180);
    await snap(page, `${w.label} (settled)`);
  }

  // ── Beat 5 — auto-tidy lands; let the layout breathe ────────────
  await sleep(800);  // BURST_DEBOUNCE_MS=700 + overhead
  await snap(page, 'auto-tidy fires');
  await sleep(HERO);
  await snap(page, 'arranged (hero 1)');

  // Expand any cards the dispatcher auto-collapsed past the threshold
  // so every widget is readable in the hero shot.
  await page.evaluate(() => {
    return import('/src/state/editor-ref.ts').then((m) => {
      const editor = m.getEditor();
      if (!editor) return;
      const shapes = editor.getCurrentPageShapes();
      for (const s of shapes) {
        if (!s.type.startsWith('opencanvas:')) continue;
        const meta = s.meta ?? {};
        if (meta.collapsed) {
          const h = meta.expandedHeight ?? 200;
          editor.updateShape({
            id: s.id, type: s.type,
            props: { ...s.props, h },
            meta: { ...meta, collapsed: false },
          });
        }
      }
      editor.zoomToFit({ animation: { duration: 400 }, inset: 60 });
    });
  });
  await sleep(700);
  await snap(page, 'expanded all');
  await sleep(HERO);
  await snap(page, 'full canvas (hero 2)');

  // ── Beat 6 — re-open the chat for the final hero shot ──────────
  await page.evaluate(() => {
    return import('/src/state/ui-store.ts').then((m) => {
      m.useUiStore.getState().setChatWindow({ mode: 'open' });
    });
  });
  await sleep(HOLD);
  await snap(page, 'chat reopened');
  await sleep(HOLD);
  await snap(page, 'final hero');

  await browser.close();

  // ── Stitch ──────────────────────────────────────────────────────
  console.log('[demo] stitching →', GIF_PATH);
  await new Promise((res, rej) => {
    const args = [
      '-y',
      '-framerate', String(FPS),
      '-i', join(OUT_DIR, 'frame-%03d.png'),
      '-vf',
      'scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
      '-loop', '0',
      GIF_PATH,
    ];
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) =>
      code === 0 ? res(undefined) : rej(new Error(`ffmpeg exit ${code}`)),
    );
  });

  if (!existsSync(GIF_PATH)) throw new Error('demo.gif not produced');
  console.log('[demo] done →', GIF_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

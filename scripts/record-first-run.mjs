#!/usr/bin/env node
/**
 * Record docs/first-run.gif: the honest first 30 seconds of a brand-new
 * user. There's no API key and no model call, and nothing is mocked:
 *   1. a fresh browser opens `pnpm start` (http://127.0.0.1:3457)
 *   2. four instant widgets are typed and placed by the local fast lane
 *   3. a script POSTs this repo's real `git log` to /v1/canvas/widgets,
 *      which is the same path any agent or cron job uses to draw here
 *
 * The captions are a recording overlay; everything under them is the
 * real app.
 *
 * Run:  pnpm start --no-open   (other terminal), then
 *       node scripts/record-first-run.mjs
 * Needs: playwright (npx playwright install chromium) and ffmpeg on PATH.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.OPENCANVAS_URL ?? 'http://127.0.0.1:3457';
const W = 1280, H = 800;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const videoDir = mkdtempSync(join(tmpdir(), 'oc-rec-'));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: W, height: H },
  colorScheme: 'dark',
  recordVideo: { dir: videoDir, size: { width: W, height: H } },
});
await ctx.addInitScript(() => {
  try {
    localStorage.removeItem('opencanvas:welcome-seeded:v1');
    localStorage.removeItem('opencanvas:auto-tidied:v1');
  } catch {}
});
const page = await ctx.newPage();
await page.goto(BASE + '/');
await page.waitForSelector('textarea');
await sleep(4500); // welcome settle (900ms) + tidy animation
await page.getByRole('button', { name: 'Dismiss tour' }).click().catch(() => {});

async function caption(text) {
  await page.evaluate((t) => {
    let el = document.getElementById('rec-caption');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rec-caption';
      el.style.cssText =
        'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99999;' +
        'padding:10px 18px;border-radius:12px;font:600 17px/1.3 Inter,system-ui,sans-serif;' +
        'color:#f5f3ff;background:rgba(20,16,36,.92);border:1px solid rgba(167,139,250,.55);' +
        'box-shadow:0 8px 30px rgba(0,0,0,.5);pointer-events:none;transition:opacity .2s';
      document.body.appendChild(el);
    }
    el.innerHTML = t;
  }, text);
}

const ta = page.locator('textarea').first();
async function instant(text, hold = 900) {
  await ta.click();
  await ta.pressSequentially(text, { delay: 55 });
  await sleep(hold); // let the preview chip read
  await ta.press('Enter');
  await sleep(1100);
}

await caption('No API key. No model. Just type.');
await sleep(900);
await instant('25 min focus');
await page.locator('.opencanvas-time-body button').first().click().catch(() => {});
await instant('standup tomorrow 9am');
await caption('Every reply is a typed widget you can drag, edit and keep.');
await instant('12 km in miles');
await instant('checklist: record the GIF, write the README, ship');
await caption('Canvas tidies itself after the first few widgets.');
await sleep(1600); // auto-tidy debounce (1200ms) + settle

await caption('Scripts and agents draw here too: <code>POST /v1/canvas/widgets</code>');
await sleep(1200);
const log = execFileSync('git', ['log', '-6', '--format=%h%x09%s%x09%cr'], { cwd: REPO, encoding: 'utf8' })
  .trim()
  .split('\n')
  .map((l) => l.split('\t'));
const token = (() => {
  try { return readFileSync(join(homedir(), '.opencanvas', 'auth-token'), 'utf8').trim(); } catch { return ''; }
})();
const res = await fetch(BASE + '/v1/canvas/widgets', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-opencanvas-token': token },
  body: JSON.stringify({
    kind: 'table',
    role: 'related',
    payload: {
      title: 'opencanvas · git log -6 (live from this repo)',
      columns: [
        { key: 'sha', label: 'Commit', mono: true },
        { key: 'msg', label: 'Message' },
        { key: 'when', label: 'When' },
      ],
      rows: log.map(([sha, msg, when]) => [sha, msg.length > 58 ? msg.slice(0, 57) + '…' : msg, when]),
    },
  }),
});
if (!res.ok) throw new Error('POST failed ' + res.status + ' ' + (await res.text()));
await sleep(1200);
// Re-tidy so the REST table joins the grid the fast-lane already made.
await ta.fill('/tidy');
await ta.press('Enter');
await sleep(1600);
await caption('Connect any model (Claude, GPT, Gemini, Ollama) and it places them for you.');
await sleep(1200);
await page.locator('[title="Minimize"]').first().click().catch(() => {});
await sleep(400);
await page.locator('[title="Fit to canvas"]').first().click().catch(() => {});
await sleep(2800);

const video = page.video();
await ctx.close();
await browser.close();
const webm = await video.path();
const gif = join(REPO, 'docs', 'first-run.gif');
const mp4 = join(REPO, 'docs', 'first-run.mp4');
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', webm, '-vf',
  'fps=10,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
  gif]);
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', webm, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '28', '-movflags', '+faststart', mp4]);
console.log('wrote', gif, 'and', mp4);

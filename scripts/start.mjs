#!/usr/bin/env node
/**
 * `pnpm start` — one process, one port, no .env required.
 *
 * Builds the SPA on first run (or when app/dist is missing), then boots
 * the backend, which serves the UI and the API on http://127.0.0.1:3457.
 * Opens your browser once the server answers, unless --no-open or CI is set.
 * Pass --rebuild to force a fresh SPA build.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const port = Number(process.env.PORT ?? process.env.OPENCANVAS_BACKEND_PORT ?? 3457);
const url = `http://127.0.0.1:${port}`;
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const [major] = process.versions.node.split('.').map(Number);
if (major < 24) {
  console.error(`OpenCanvas needs Node 24 or newer (you have ${process.versions.node}).`);
  process.exit(1);
}

if (args.has('--rebuild') || !existsSync(join(ROOT, 'app', 'dist', 'index.html'))) {
  console.log('==> Building the UI (first run only, ~20s)…');
  const r = spawnSync(pnpm, ['app:build'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log(`==> Starting OpenCanvas on ${url}`);
const child = spawn(pnpm, ['tsx', 'src/backend/server.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, OPENCANVAS_BACKEND_PORT: String(port) },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));

if (!args.has('--no-open') && !process.env.CI) {
  const deadline = Date.now() + 60_000;
  const poll = async () => {
    try {
      const r = await fetch(`${url}/v1/health`);
      if (r.ok) {
        console.log(`\n  ➜  OpenCanvas is ready: ${url}\n     Type "25 min focus" and press Enter. No API key needed.\n`);
        const opener =
          process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).on('error', () => {});
        return;
      }
    } catch {
      /* not up yet */
    }
    if (Date.now() < deadline) setTimeout(poll, 500);
  };
  setTimeout(poll, 800);
}

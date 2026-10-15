#!/usr/bin/env node
/**
 * npx opencanvas: install or update OpenCanvas, then run `pnpm start`.
 *
 *   npx opencanvas            install to ~/.opencanvas/app (first run) and start
 *   npx opencanvas --update   pull the latest main (fast-forward only), reinstall, rebuild, start
 *   npx opencanvas --dir P    use P instead of ~/.opencanvas/app
 *   npx opencanvas --dry-run  print what would run, change nothing
 *   (any other flag, e.g. --no-open, is passed through to `pnpm start`)
 *
 * Needs Node 24+ and git. pnpm is used through corepack (bundled with
 * Node), so nothing global is installed. Zero dependencies on purpose.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const REPO = 'https://github.com/ashark-ai-05/opencanvas.git';

export function parseArgs(argv) {
  const out = { dir: join(homedir(), '.opencanvas', 'app'), update: false, dryRun: false, pass: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--update') out.update = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--dir') out.dir = resolve(argv[++i] ?? out.dir);
    else if (a === '-h' || a === '--help') out.help = true;
    else out.pass.push(a);
  }
  return out;
}

/** The exact command sequence, so it can be printed (--dry-run) and tested. */
export function plan({ dir, update, pass }, exists = existsSync) {
  const steps = [];
  const installed = exists(join(dir, 'package.json'));
  const pnpm = ['corepack', 'pnpm'];
  if (!installed) {
    steps.push(['git', 'clone', '--depth', '1', REPO, dir]);
  } else if (update) {
    steps.push(['git', '-C', dir, 'pull', '--ff-only']);
  }
  if (!installed || update || !exists(join(dir, 'node_modules'))) {
    steps.push([...pnpm, 'install', '--frozen-lockfile']);
  }
  steps.push([...pnpm, 'start', ...(update ? ['--rebuild'] : []), ...pass]);
  return steps;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: npx opencanvas [--update] [--dir PATH] [--dry-run] [--no-open]');
    return 0;
  }
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 24) {
    console.error(`OpenCanvas needs Node 24+ (you have ${process.versions.node}). https://nodejs.org`);
    return 1;
  }
  const steps = plan(args);
  for (const [cmd, ...rest] of steps) {
    const cwd = cmd === 'git' ? undefined : args.dir;
    console.log(`\n$ ${[cmd, ...rest].join(' ')}${cwd ? `   (in ${cwd})` : ''}`);
    if (args.dryRun) continue;
    const r = spawnSync(cmd, rest, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
    });
    if (r.error) {
      console.error(`Could not run ${cmd}: ${r.error.message}${cmd === 'git' ? ' (is git installed?)' : ''}`);
      return 1;
    }
    if (r.status !== 0) return r.status ?? 1;
  }
  return 0;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (isMain) process.exit(main());

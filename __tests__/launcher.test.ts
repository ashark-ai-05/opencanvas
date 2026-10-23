import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BIN = resolve(__dirname, '..', 'launcher', 'bin', 'opencanvas.mjs');
const dry = (...args: string[]) =>
  spawnSync(process.execPath, [BIN, '--dry-run', ...args], { encoding: 'utf8' }).stdout
    .split('\n')
    .filter((l) => l.startsWith('$ '))
    .map((l) => l.replace(/\s+\(in .*\)$/, ''));

describe('npx @ashark/opencanvas launcher (dry run)', () => {
  it('clones, installs and starts on first run, passing flags through', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'oc-l-')), 'app');
    expect(dry('--dir', dir, '--no-open')).toEqual([
      `$ git clone --depth 1 https://github.com/ashark-ai-05/opencanvas.git ${dir}`,
      '$ corepack pnpm install --frozen-lockfile',
      '$ corepack pnpm start --no-open',
    ]);
  });
  it('just starts an existing install, and fast-forwards + rebuilds on --update', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-l-'));
    writeFileSync(join(dir, 'package.json'), '{}');
    mkdirSync(join(dir, 'node_modules'));
    expect(dry('--dir', dir)).toEqual(['$ corepack pnpm start']);
    expect(dry('--dir', dir, '--update')).toEqual([
      `$ git -C ${dir} pull --ff-only`,
      '$ corepack pnpm install --frozen-lockfile',
      '$ corepack pnpm start --rebuild',
    ]);
  });
  it('runs when invoked through an extensionless bin symlink, as npx does', () => {
    // npm links node_modules/.bin/opencanvas -> ../@ashark/opencanvas/bin/opencanvas.mjs
    // and node then sees argv[1] = ".../.bin/opencanvas". The entry-point guard
    // must still recognise itself, or `npx @ashark/opencanvas` exits 0 silently.
    const binDir = join(mkdtempSync(join(tmpdir(), 'oc-l-')), '.bin');
    mkdirSync(binDir);
    const link = join(binDir, 'opencanvas');
    symlinkSync(BIN, link);
    const r = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage: npx @ashark/opencanvas');
  });
});

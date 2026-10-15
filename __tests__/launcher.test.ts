import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BIN = resolve(__dirname, '..', 'launcher', 'bin', 'opencanvas.mjs');
const dry = (...args: string[]) =>
  spawnSync(process.execPath, [BIN, '--dry-run', ...args], { encoding: 'utf8' }).stdout
    .split('\n')
    .filter((l) => l.startsWith('$ '))
    .map((l) => l.replace(/\s+\(in .*\)$/, ''));

describe('npx opencanvas launcher (dry run)', () => {
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
});

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const TSX = join(ROOT, 'node_modules', '.bin', 'tsx');

function tokenFrom(home: string): Promise<string> {
  return new Promise((ok, fail) => {
    const p = spawn(
      TSX,
      ['-e', "import('./src/backend/auth.ts').then(m => process.stdout.write(m.getAuthToken()))"],
      { cwd: ROOT, env: { ...process.env, HOME: home, USERPROFILE: home, OPENCANVAS_AUTH_TOKEN: '' } },
    );
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', fail);
    p.on('exit', (code) => (code === 0 ? ok(out.trim()) : fail(new Error('exit ' + code))));
  });
}

describe('auth token file', () => {
  it('concurrent first boots agree on one token and leave no temp files', { timeout: 60_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), 'oc-token-'));
    const tokens = await Promise.all(Array.from({ length: 6 }, () => tokenFrom(home)));
    const onDisk = readFileSync(join(home, '.opencanvas', 'auth-token'), 'utf8').trim();
    expect(new Set(tokens)).toEqual(new Set([onDisk]));
    expect(onDisk).toMatch(/^[0-9a-f]{64}$/);
    expect(readdirSync(join(home, '.opencanvas')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    if (process.platform !== 'win32') {
      expect(statSync(join(home, '.opencanvas', 'auth-token')).mode & 0o777).toBe(0o600);
    }
  });
});

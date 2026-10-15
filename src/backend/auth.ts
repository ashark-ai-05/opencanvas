/**
 * Backend token auth — defense against malicious local processes hitting
 * the loopback API. The CORS lockdown closes cross-tab CSRF, but a rogue
 * process running on the same machine can still POST to 127.0.0.1:3457
 * with no Origin header. This module gates state-mutating routes behind
 * a random token persisted to ~/.opencanvas/auth-token (mode 0600).
 *
 * Token surfacing per host:
 *   - Vite dev server  → injects header server-side (proxy plugin reads file)
 *   - Electron prod    → main.cjs reads file, preload exposes window.opencanvasAuth
 *   - curl / SDK use   → user reads the file themselves: `cat ~/.opencanvas/auth-token`
 *
 * Bypasses (intentional):
 *   - NODE_ENV=test                         → unit tests use app.request() directly
 *   - OPENCANVAS_REQUIRE_AUTH=0             → explicit opt-out for power users
 *   - GET requests                          → low-risk read paths stay open so
 *                                             debugging with curl is friction-free
 *   - /v1/health                            → liveness probe is unauthenticated
 */
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync, linkSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';

const TOKEN_FILE = join(homedir(), '.opencanvas', 'auth-token');
const HEADER = 'x-opencanvas-token';

let cachedToken: string | null = null;

export function getAuthToken(): string {
  if (cachedToken) return cachedToken;
  // Explicit env override beats the file — used by the bundled Electron
  // backend so main.cjs and the renderer share a single value without a
  // file-system round-trip per request.
  const envToken = process.env['OPENCANVAS_AUTH_TOKEN'];
  if (envToken && envToken.length >= 16) {
    cachedToken = envToken;
    return cachedToken;
  }
  if (existsSync(TOKEN_FILE)) {
    const t = readFileSync(TOKEN_FILE, 'utf8').trim();
    if (t.length >= 16) {
      cachedToken = t;
      return cachedToken;
    }
  }
  // Write atomically and never clobber: two processes booting at once
  // (backend + CLI, or parallel test workers) used to be able to read a
  // half-written file, decide it was invalid and overwrite it, leaving
  // the running server holding a token nobody else could read.
  const generated = randomBytes(32).toString('hex');
  mkdirSync(join(homedir(), '.opencanvas'), { recursive: true });
  const tmp = `${TOKEN_FILE}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, generated, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // chmod may fail on Windows; the file is still in the user's
    // profile directory so accessibility is limited by OS ACLs.
  }
  try {
    // link() fails if the token already exists → someone else won the race.
    linkSync(tmp, TOKEN_FILE);
  } catch {
    try {
      const winner = readFileSync(TOKEN_FILE, 'utf8').trim();
      if (winner.length >= 16) {
        unlinkSync(tmp);
        cachedToken = winner;
        return cachedToken;
      }
    } catch {
      /* fall through: replace the invalid file */
    }
    renameSync(tmp, TOKEN_FILE);
  }
  try {
    unlinkSync(tmp);
  } catch {
    /* already renamed */
  }
  cachedToken = generated;
  return cachedToken;
}

export function getAuthTokenPath(): string {
  return TOKEN_FILE;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  if (process.env['NODE_ENV'] === 'test') return next();
  if (process.env['OPENCANVAS_REQUIRE_AUTH'] === '0') return next();
  if (!MUTATING.has(c.req.method)) return next();
  // Health stays open even for POST (none defined, but guard regardless).
  if (c.req.path === '/v1/health') return next();

  const provided = c.req.header(HEADER) ?? c.req.header(HEADER.toUpperCase());
  const expected = getAuthToken();
  if (provided !== expected) {
    return c.json(
      {
        error: 'unauthorized',
        hint:
          'Pass the token from ~/.opencanvas/auth-token in the X-OpenCanvas-Token header.',
      },
      401,
    );
  }
  return next();
};

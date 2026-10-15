import { describe, it, expect, afterEach } from 'vitest';
import { withLocalToken, isLoopbackHost } from '../src/backend/server';
import { getAuthToken } from '../src/backend/auth';

const HTML = '<!doctype html><html><head><title>x</title></head></html>';

describe('single-port local mode token injection', () => {
  afterEach(() => {
    delete process.env['OPENCANVAS_DEMO'];
  });
  it('injects the token for loopback hosts only', () => {
    const out = withLocalToken(HTML, '127.0.0.1:3457');
    expect(out).toContain(`<meta name="opencanvas-token" content="${getAuthToken()}" />`);
    expect(withLocalToken(HTML, 'localhost:3457')).toContain('opencanvas-token');
  });
  it('never injects for foreign hosts (DNS rebinding) or a missing Host', () => {
    expect(withLocalToken(HTML, 'evil.example:3457')).toBe(HTML);
    expect(withLocalToken(HTML, '127.0.0.1.evil.example')).toBe(HTML);
    expect(withLocalToken(HTML, undefined)).toBe(HTML);
  });
  it('never injects in public demo mode', () => {
    process.env['OPENCANVAS_DEMO'] = '1';
    expect(withLocalToken(HTML, '127.0.0.1:3457')).toBe(HTML);
  });
  it('parses loopback hosts', () => {
    expect(isLoopbackHost('[::1]:3457')).toBe(true);
    expect(isLoopbackHost('LOCALHOST')).toBe(true);
    expect(isLoopbackHost('0.0.0.0:3457')).toBe(false);
  });
});

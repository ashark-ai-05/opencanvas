import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');

describe('customware skeleton', () => {
  it('module manifest exists and has required fields', () => {
    const manifestPath = join(
      root,
      'customware/L1/_all/mod/krunal/llm-wiki/mod.yaml'
    );
    expect(existsSync(manifestPath)).toBe(true);
    const content = readFileSync(manifestPath, 'utf8');
    expect(content).toMatch(/^name:\s*llm-wiki/m);
    expect(content).toMatch(/^owner:\s*krunal/m);
  });

  it('proof-of-wire banner exists', () => {
    const bannerPath = join(
      root,
      'customware/L1/_all/mod/krunal/llm-wiki/ext/html/_core/dashboard/content_end/llm-wiki-banner.html'
    );
    expect(existsSync(bannerPath)).toBe(true);
    const content = readFileSync(bannerPath, 'utf8');
    expect(content).toMatch(/llm-wiki.*customware loaded successfully/);
  });
});

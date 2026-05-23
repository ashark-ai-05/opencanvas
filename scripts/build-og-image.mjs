// Rasterize build/og-image.svg → app/public/og-image.png at 1200×630.
// Reused for og: + twitter:image meta tags so link previews on HN /
// Twitter / Slack / iMessage are branded instead of "naked links".
//
// Usage: node scripts/build-og-image.mjs

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = join(ROOT, 'build', 'og-image.svg');
const PUBLIC_DIR = join(ROOT, 'app', 'public');
const OUT = join(PUBLIC_DIR, 'og-image.png');

mkdirSync(PUBLIC_DIR, { recursive: true });

const svg = readFileSync(SVG, 'utf8');
const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const W = 1200;
const H = 630;

console.log('[og-image] launching chromium');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();

const html = `<!doctype html><html><head><style>
  html,body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden}
  img{display:block;width:${W}px;height:${H}px}
</style></head><body><img src="${dataUrl}"/></body></html>`;

await page.setContent(html, { waitUntil: 'load' });
const buf = await page.screenshot({
  type: 'png',
  clip: { x: 0, y: 0, width: W, height: H },
});
writeFileSync(OUT, buf);
console.log(`[og-image] wrote ${OUT} (${buf.length} bytes, ${W}×${H})`);

await browser.close();

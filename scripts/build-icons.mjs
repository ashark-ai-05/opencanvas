// Rasterize build/icon.svg → PNG at all the sizes electron-builder
// needs, then bundle the macOS .iconset into a single .icns. Windows
// .ico is produced from the 256px PNG via the png-to-ico npm package
// — call this script with PNG_ONLY=1 to skip the .ico step if that
// dep isn't installed.
//
// Usage: node scripts/build-icons.mjs

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVG = join(ROOT, 'build', 'icon.svg');
const OUT = join(ROOT, 'build', 'icons');
const ICONSET = join(ROOT, 'build', 'AppIcon.iconset');

mkdirSync(OUT, { recursive: true });
if (existsSync(ICONSET)) rmSync(ICONSET, { recursive: true });
mkdirSync(ICONSET);

const svg = readFileSync(SVG, 'utf8');
const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const targets = [16, 32, 48, 64, 128, 256, 512, 1024];

console.log('[icons] launching chromium for SVG rasterization');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1024, height: 1024 } });
const page = await ctx.newPage();

for (const size of targets) {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden}
    img{display:block;width:${size}px;height:${size}px}
  </style></head><body><img src="${dataUrl}"/></body></html>`;

  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html, { waitUntil: 'load' });
  const buf = await page.screenshot({
    type: 'png',
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });

  const fname = join(OUT, `icon-${size}.png`);
  writeFileSync(fname, buf);
  console.log(`[icons] wrote ${fname} (${buf.length} bytes)`);

  if ([16, 32, 64, 128, 256, 512].includes(size)) {
    writeFileSync(join(ICONSET, `icon_${size}x${size}.png`), buf);
  }
  if (size === 1024) {
    writeFileSync(join(ICONSET, 'icon_512x512@2x.png'), buf);
  }
}

await browser.close();

writeFileSync(join(ROOT, 'build', 'icon.png'), readFileSync(join(OUT, 'icon-1024.png')));
console.log('[icons] wrote build/icon.png (Linux + fallback)');

// macOS .icns via Apple's iconutil (no shell — execFileSync passes
// arguments directly to execve, no injection surface).
try {
  execFileSync(
    'iconutil',
    ['-c', 'icns', '-o', join(ROOT, 'build', 'icon.icns'), ICONSET],
    { stdio: 'inherit' },
  );
  console.log('[icons] wrote build/icon.icns');
} catch (err) {
  console.warn('[icons] iconutil failed (skipping .icns):', err?.message ?? err);
}

if (process.env.PNG_ONLY !== '1') {
  try {
    const mod = await import('png-to-ico');
    const png2ico = mod.default;
    const sizes = [16, 32, 48, 64, 128, 256].map((s) =>
      readFileSync(join(OUT, `icon-${s}.png`)),
    );
    const ico = await png2ico(sizes);
    writeFileSync(join(ROOT, 'build', 'icon.ico'), ico);
    console.log('[icons] wrote build/icon.ico');
  } catch (err) {
    console.warn(
      '[icons] skipping .ico — install with `pnpm add -D png-to-ico` to enable',
    );
    console.warn('       reason:', err?.message ?? err);
  }
}

console.log('[icons] done');

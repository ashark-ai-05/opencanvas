#!/usr/bin/env node
/**
 * Copy third-party JS libs used by built-in plugin widgets out of
 * `node_modules/` and into `app/public/vendor/`. Run before
 * `pnpm app:build` (wired as `preapp:build` in package.json).
 *
 * Why this exists:
 *   The OpenCanvas SPA ships with a strict `script-src 'self'` CSP
 *   (see app/index.html). That CSP applies to scripts loaded inside
 *   srcdoc iframes too — so the built-in plugin widgets (mermaid,
 *   chart) can't fetch from cdn.jsdelivr.net. Hosting these libs
 *   same-origin under `/vendor/` makes them load under `'self'`.
 *
 *   Bonus: zero runtime CDN dependency. Plugins work offline / behind
 *   firewalls / when jsdelivr is having a bad day.
 *
 * To add another lib:
 *   1. `pnpm add <lib>`
 *   2. Append an entry to LIBS below (source path inside node_modules
 *      + dest filename under app/public/vendor/)
 *   3. Update the srcdoc that needs it to reference `/vendor/<file>.js`
 *
 * The destination is gitignored (see .gitignore) — these are
 * build artefacts, not source.
 */
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEST_DIR = join(ROOT, 'app', 'public', 'vendor');

const LIBS = [
  // Mermaid — flowcharts, sequence diagrams, gantt charts, etc.
  { src: 'node_modules/mermaid/dist/mermaid.min.js', dest: 'mermaid.min.js' },
  // Vega + Vega-Lite + Vega-Embed — used by the `chart` plugin.
  { src: 'node_modules/vega/build/vega.min.js', dest: 'vega.min.js' },
  { src: 'node_modules/vega-lite/build/vega-lite.min.js', dest: 'vega-lite.min.js' },
  { src: 'node_modules/vega-embed/build/vega-embed.min.js', dest: 'vega-embed.min.js' },
];

mkdirSync(DEST_DIR, { recursive: true });

let copied = 0;
let missing = 0;
for (const { src, dest } of LIBS) {
  const srcPath = join(ROOT, src);
  const destPath = join(DEST_DIR, dest);
  if (!existsSync(srcPath)) {
    console.warn(`[copy-vendor-libs] missing source: ${src} — run \`pnpm install\` first`);
    missing++;
    continue;
  }
  copyFileSync(srcPath, destPath);
  copied++;
}

console.log(`[copy-vendor-libs] copied ${copied} file(s) to ${DEST_DIR}` + (missing ? ` (${missing} missing)` : ''));
if (missing > 0) process.exit(1);

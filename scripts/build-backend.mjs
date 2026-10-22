#!/usr/bin/env node
/**
 * Bundle the backend into dist-backend/server.js for the packaged Electron
 * app (electron/main.cjs spawns it with ELECTRON_RUN_AS_NODE=1).
 *
 * One ESM file; native modules stay external and are resolved from
 * node_modules at runtime (electron-builder unpacks them from the asar, see
 * `build.asarUnpack` in package.json). docs/openapi.yaml is copied next to
 * the bundle so /openapi.yaml keeps working without the docs/ tree.
 */
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist-backend', { recursive: true, force: true });
mkdirSync('dist-backend');

await build({
  entryPoints: ['src/backend/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  outfile: 'dist-backend/server.js',
  external: ['better-sqlite3', 'onnxruntime-node', 'sqlite-vec', 'web-tree-sitter', 'tree-sitter-typescript', '@huggingface/transformers', 'electron'],
  banner: {
    // CJS dependencies inside the bundle still call require().
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'warning',
});
copyFileSync('docs/openapi.yaml', 'dist-backend/openapi.yaml');
console.log('dist-backend/server.js written');

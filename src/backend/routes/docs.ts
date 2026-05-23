import type { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * GET /openapi.yaml  — serve the static OpenAPI 3.1 spec.
 * GET /docs          — Scalar API Reference, a polished Swagger UI
 *                      alternative. Loaded from a CDN script so we
 *                      don't add an npm dependency just for docs.
 *
 * The spec lives at docs/openapi.yaml at the repo root and is bundled
 * into the dist tree by the build step. We read it once at boot and
 * cache the bytes — it doesn't change at runtime.
 */
export function docsRoute(r: Hono): void {
  let cachedSpec: string | null = null;
  const SPEC_CANDIDATES = (() => {
    const here = dirname(fileURLToPath(import.meta.url));
    return [
      join(here, '../../../docs/openapi.yaml'),  // dev (tsx)
      join(here, '../../docs/openapi.yaml'),     // bundled backend (one level less)
      join(here, '../openapi.yaml'),             // bundled into dist-backend root
    ];
  })();

  function loadSpec(): string {
    if (cachedSpec) return cachedSpec;
    for (const candidate of SPEC_CANDIDATES) {
      try {
        cachedSpec = readFileSync(candidate, 'utf8');
        return cachedSpec;
      } catch {
        /* try next */
      }
    }
    return '# OpenAPI spec not found at build time.\n';
  }

  r.get('/openapi.yaml', (c) => {
    return c.body(loadSpec(), 200, { 'content-type': 'application/yaml; charset=utf-8' });
  });

  // Scalar API Reference: single-file HTML, loads the spec from the
  // sibling /openapi.yaml endpoint. Configured to match the dark
  // brand palette. Auth-token field is pre-wired so "Try it out"
  // actually works for state-mutating calls.
  r.get('/docs', (c) => {
    // Configuration is serialized into a data-configuration attribute
    // Scalar reads on init. customCss kept on a single line because we
    // can't use backticks inside the outer template literal.
    const config = JSON.stringify({
      theme: 'purple',
      layout: 'modern',
      darkMode: true,
      hideClientButton: false,
      defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
      metaData: { title: 'OpenCanvas API · docs' },
      authentication: {
        preferredSecurityScheme: 'bearerToken',
        apiKey: { token: '' },
      },
      customCss:
        '.scalar-app .references-header,' +
        ' .scalar-app .sidebar { background: rgba(10,10,10,0.92); }' +
        ' .scalar-app a { color: #c4b5fd; }',
    });
    const html =
      '<!doctype html>' +
      '<html lang="en"><head>' +
      '<meta charset="utf-8" />' +
      '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
      '<title>OpenCanvas API · docs</title>' +
      '<style>body{margin:0;background:#0a0a0a;color:#fafafa;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif}</style>' +
      '</head><body>' +
      '<script id="api-reference" data-url="/openapi.yaml" data-configuration=\'' +
      config.replace(/'/g, '&#39;') +
      '\'></script>' +
      '<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>' +
      '</body></html>';
    return c.html(html);
  });
}

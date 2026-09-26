import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { cors } from 'hono/cors';
import { BackendState } from './state.js';
import { healthRoute } from './routes/health.js';
import { queryOpenAIRoute } from './routes/query-openai.js';
import { chatRoute } from './routes/chat.js';
import { searchRoute } from './routes/search.js';
import { indexConversationRoute } from './routes/index-conversation.js';
import { teamRoute } from './routes/team.js';
import { sourcesListRoute } from './routes/sources-list.js';
import { canvasRoute } from './routes/canvas.js';
import { schedulesRoute } from './routes/schedules.js';
import { notebookRoute } from './routes/notebook.js';
import { pluginFetchRoute } from './routes/plugin-fetch.js';
import { shareRoute } from './routes/share.js';
import { docsRoute } from './routes/docs.js';
import { authMiddleware, getAuthToken, getAuthTokenPath } from './auth.js';
import { isDemoMode, demoRateLimit } from './demo.js';

/**
 * The Hono app. Tests can hit `app.request(path)` directly without
 * spinning up an HTTP listener. The standalone listener is started
 * by `start()` in the same module.
 *
 * Routes are eagerly declared, but the BackendState is lazily initialized on
 * first request. This avoids blocking module import on profile loading while
 * keeping the route structure static (required by Hono's router).
 */
export const app = new Hono();

// CORS: explicit localhost-only allowlist. The previous `origin: (o) => o`
// reflected any origin, which let a malicious tab visited while OpenCanvas
// was running POST to the local backend. Now we only allow the Vite dev
// server origin, the Electron app file:// origin, and direct same-origin
// requests (which arrive with no Origin header — those return null from
// the function and hono/cors treats that as same-origin).
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3458',
  'http://127.0.0.1:3458',
  // Vite preview port (rare, but used when verifying production bundles).
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);
app.use(
  '/*',
  cors({
    origin: (origin) => {
      // Demo mode: any origin is fine, visitors hit the Railway URL.
      if (isDemoMode()) return origin ?? '';
      if (!origin) return ''; // no Origin → same-origin or curl → allow
      // Electron loads the app from file:// — origin is "null" string.
      if (origin === 'null') return origin;
      return ALLOWED_ORIGINS.has(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'X-OpenCanvas-Token',
      // BYO-key headers sent by the settings menu (per-request override
      // of profile.llm provider / model / API key). Never persisted on
      // the server — used only within the resolve call for that request.
      'X-OpenCanvas-Provider',
      'X-OpenCanvas-Model',
      'X-OpenCanvas-Api-Key',
    ],
  }),
);

// Token auth on state-mutating /v1/* routes. See auth.ts for the
// bypass rules (NODE_ENV=test, OPENCANVAS_REQUIRE_AUTH=0, GETs). Demo
// mode disables auth entirely so visitors don't need a token — the
// per-IP rate limiter below is what stops abuse instead.
if (!isDemoMode()) {
  app.use('/v1/*', authMiddleware);
}

// Public-demo rate limiter on /v1/chat (5 messages per hour per IP).
// No-op when OPENCANVAS_DEMO is not set.
app.use('/v1/chat', demoRateLimit);

// /docs (Scalar API Reference) + /openapi.yaml (the spec).
// Public — exposed at the backend root rather than under /v1 so it
// shows up at http://127.0.0.1:3457/docs without auth (the docs page
// itself is read-only; the "Try it out" calls still need a token).
docsRoute(app);

let statePromise: Promise<BackendState> | null = null;

export function getState(): Promise<BackendState> {
  if (!statePromise) statePromise = BackendState.create();
  return statePromise;
}

// Health
app.get('/v1/health', async (c) => {
  const state = await getState();
  // `profile` is the config-file label (e.g. 'claude-sdk') — kept for
  // diagnostics. The UI displays `llm` + `model` instead, because the
  // profile NAME can be misleading: a profile named 'claude-sdk' can
  // have its llm env-overridden to gemini (which is the demo's case).
  const llmConfig = state.profile.llm as { provider: string; model?: string };
  return c.json({
    ok: true,
    profile: state.profileName,
    llm: state.getLLMProvider().id,
    model: llmConfig.model ?? null,
    embedder: state.getEmbedder().id,
    demo: isDemoMode(),
  });
});

// Sources — list, probe, tools, call
app.get('/v1/sources', async (c) => {
  const state = await getState();
  return c.json({
    sources: state.profile.sources.map((s) => ({
      id: s.id,
      name: s.name,
      transport: s.transport,
    })),
  });
});

app.get('/v1/sources/probe', async (c) => {
  const state = await getState();
  const registry = state.getSourceRegistry();
  const result = await registry.connectAll(state.profile.sources);
  return c.json({
    ok: result.ok.map((s) => ({
      id: s.id,
      name: s.name,
      health: s.health,
      toolCount: s.tools.length,
    })),
    failed: result.failed.map((f) => ({
      id: f.config.id,
      name: f.config.name,
      error: f.error,
    })),
  });
});

app.get('/v1/sources/:id/tools', async (c) => {
  const state = await getState();
  const id = c.req.param('id');
  const config = state.profile.sources.find((s) => s.id === id);
  if (!config) return c.json({ error: `unknown source: ${id}` }, 404);

  const { createMcpClient } = await import('../mcp/transport.js');
  const { MCPSource } = await import('../mcp/source.js');
  const client = await createMcpClient(config);
  const source = new MCPSource(config.id, config.name, client);
  try {
    await source.introspect();
    return c.json({ id: source.id, name: source.name, tools: source.tools });
  } finally {
    await source.close();
  }
});

app.post('/v1/sources/:id/tools/:tool', async (c) => {
  const state = await getState();
  const id = c.req.param('id');
  const toolName = c.req.param('tool');
  const config = state.profile.sources.find((s) => s.id === id);
  if (!config) return c.json({ error: `unknown source: ${id}` }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { args?: unknown };
  const { createMcpClient } = await import('../mcp/transport.js');
  const { MCPSource } = await import('../mcp/source.js');
  const client = await createMcpClient(config);
  const source = new MCPSource(config.id, config.name, client);
  try {
    const result = await source.callTool(toolName, body.args ?? {});
    return c.json({ ok: true, result });
  } catch (e) {
    return c.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      500
    );
  } finally {
    await source.close();
  }
});

// Embed
app.post('/v1/embed', async (c) => {
  const state = await getState();
  const body = (await c.req.json().catch(() => ({}))) as {
    texts?: string[];
  };
  if (!Array.isArray(body.texts) || body.texts.length === 0) {
    return c.json({ error: 'texts must be a non-empty array' }, 400);
  }
  const embedder = state.getEmbedder();
  const vectors = await embedder.embed(body.texts);
  return c.json({
    embedder: embedder.id,
    dims: embedder.dims,
    vectors: vectors.map((v) => Array.from(v)),
  });
});

// Query — streams text deltas via SSE
app.post('/v1/query', async (c) => {
  const state = await getState();
  const body = (await c.req.json().catch(() => ({}))) as {
    prompt?: string;
    systemPrompt?: string;
  };
  if (!body.prompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  return streamSSE(c, async (stream) => {
    const provider = state.getLLMProvider();
    try {
      for await (const event of provider.query({
        prompt: body.prompt!,
        systemPrompt: body.systemPrompt,
      })) {
        await stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        });
      }
    } catch (e) {
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          type: 'error',
          message: e instanceof Error ? e.message : String(e),
        }),
      });
    }
  });
});

// Query (OpenAI chat-completions format) — accepts OpenAI-shaped request, streams OpenAI SSE
// The queryOpenAIRoute factory needs a BackendState; we create one eagerly and mount.
// We use a lazy-resolved sub-app to avoid blocking module import.
{
  const lazyApp = new Hono();
  lazyApp.post('/v1/query/openai', async (c) => {
    const state = await getState();
    const sub = queryOpenAIRoute(state);
    return sub.fetch(c.req.raw);
  });
  app.route('/', lazyApp);
}

// Chat (AI SDK 6 UI Message Stream protocol) — used by the React app's useChat hook.
// For OpenAI-compat callers, use /v1/query/openai instead.
// chatRoute also serves POST /v1/cancel-stream/:id; mount with .all() so
// every path the sub-app declares is reachable, not just /v1/chat.
{
  const lazyApp = new Hono();
  const handler = async (c: import('hono').Context) => {
    const state = await getState();
    const sub = chatRoute(state);
    return sub.fetch(c.req.raw);
  };
  lazyApp.post('/v1/chat', handler);
  lazyApp.post('/v1/cancel-stream/:id', handler);
  app.route('/', lazyApp);
}

// /v1/canvas/* — external app surface. Long-lived SSE for browser
// subscribers + REST for mutations. See routes/canvas.ts.
{
  const lazyApp = new Hono();
  lazyApp.all('/v1/canvas/*', async (c) => {
    const state = await getState();
    const sub = canvasRoute(state);
    return sub.fetch(c.req.raw);
  });
  app.route('/', lazyApp);
}

// /v1/schedules — cron-driven background agent runs. CRUD + run-now.
{
  const lazyApp = new Hono();
  lazyApp.all('/v1/schedules', async (c) => {
    const state = await getState();
    const sub = schedulesRoute(state);
    return sub.fetch(c.req.raw);
  });
  lazyApp.all('/v1/schedules/*', async (c) => {
    const state = await getState();
    const sub = schedulesRoute(state);
    return sub.fetch(c.req.raw);
  });
  app.route('/', lazyApp);
}

// /v1/notepad — singleton notes. /v1/tasks — task CRUD + calendar query.
{
  const lazyApp = new Hono();
  lazyApp.all('/v1/notepad', async (c) => {
    const state = await getState();
    const sub = notebookRoute(state);
    return sub.fetch(c.req.raw);
  });
  lazyApp.all('/v1/tasks', async (c) => {
    const state = await getState();
    const sub = notebookRoute(state);
    return sub.fetch(c.req.raw);
  });
  lazyApp.all('/v1/tasks/*', async (c) => {
    const state = await getState();
    const sub = notebookRoute(state);
    return sub.fetch(c.req.raw);
  });
  app.route('/', lazyApp);
}

// Search — POST /v1/search, wraps SearchService with Result envelope
{
  const lazyApp = new Hono();
  lazyApp.post('/v1/search', async (c) => {
    const state = await getState();
    const sub = searchRoute(state);
    return sub.fetch(c.req.raw);
  });
  app.route('/', lazyApp);
}

// Self-improving KB — POST /v1/index-conversation chunks + embeds chat
// turns into the same SQLite store as docs/code, so search_kb surfaces
// prior conversations alongside indexed content.
{
  const lazyApp = new Hono();
  lazyApp.post('/v1/index-conversation', async (c) => {
    const state = await getState();
    const sub = indexConversationRoute(state);
    return sub.fetch(c.req.raw);
  });
  app.route('/', lazyApp);
}

// Multi-agent team — POST /v1/team runs Researcher → Builder → Critic
// sequentially over a single user prompt, streaming all phases as one
// useChat-compatible UIMS message.
{
  const lazyApp = new Hono();
  lazyApp.post('/v1/team', async (c) => {
    const state = await getState();
    const sub = teamRoute(state);
    return sub.fetch(c.req.raw);
  });
  app.route('/', lazyApp);
}

// GET /v1/sources/list — enumerates every source_id in the chunks table
// with chunk counts. Drives the Sources popover in the UI.
{
  const lazyApp = new Hono();
  lazyApp.get('/v1/sources/list', async (c) => {
    const state = await getState();
    const sub = sourcesListRoute(state);
    return sub.fetch(c.req.raw);
  });
  app.route('/', lazyApp);
}

// /v1/plugin-fetch — outbound HTTP proxy for sandboxed plugin iframes.
// Iframes run with allow-scripts only (null origin); many APIs reject null-origin
// CORS requests. This proxy performs the request server-side and returns the
// response with Access-Control-Allow-Origin: * so the iframe can read it.
// SSRF-guarded: blocks private/loopback IPs, localhost names, cloud metadata.
{
  const lazyApp = new Hono();
  lazyApp.all('/v1/plugin-fetch', async (c) => {
    const state = await getState();
    const sub = pluginFetchRoute(state);
    return sub.fetch(c.req.raw);
  });
  app.route('/', lazyApp);
}

// /v1/share — viral-loop endpoints. POST creates a public read-only
// snapshot (canvas + chat) and returns an id; GET /v1/share/:id reads
// it (and bumps view_count). Anonymous, per-IP rate-limited at the
// route. See src/backend/routes/share.ts.
{
  const lazyApp = new Hono();
  lazyApp.all('/v1/share', async (c) => {
    const state = await getState();
    const sub = shareRoute(state);
    return sub.fetch(c.req.raw);
  });
  lazyApp.all('/v1/share/:id', async (c) => {
    const state = await getState();
    const sub = shareRoute(state);
    return sub.fetch(c.req.raw);
  });
  app.route('/', lazyApp);
}

// Out-of-process MCP backing endpoints (used by src/mcp-server/index.ts
// when OpenCanvas runs under the Amp profile and the agent's tools are
// hosted in a separate stdio process). These are thin proxies over the
// existing services.
{
  const lazyApp = new Hono();
  lazyApp.get('/v1/fetch', async (c) => {
    const state = await getState();
    const id = c.req.query('id');
    if (!id) return c.json({ error: 'id is required' }, 400);
    const search = state.getSearchService();
    const out = await search.fetchById(id);
    if (!out) return c.json({ error: 'not found' }, 404);
    return c.json(out);
  });
  app.route('/', lazyApp);
}

{
  const lazyApp = new Hono();
  lazyApp.post('/v1/web-search', async (c) => {
    const state = await getState();
    const body = (await c.req.json().catch(() => ({}))) as {
      query?: string;
      limit?: number;
    };
    if (!body.query) return c.json({ error: 'query is required' }, 400);
    const provider = state.getWebSearchProvider();
    const results = await provider.search(body.query, body.limit ?? 5);
    return c.json({ results });
  });
  app.route('/', lazyApp);
}

// /v1/canvas-snapshot:
//   GET   → full snapshot ({activeTemplateId, widgets[]})
//   POST  → { id } → single widget payload
//
// Both are populated by `chat.ts` mirroring the user's last canvasSnapshot
// into BackendState.setLatestSnapshot — read-only for the MCP server.
{
  const lazyApp = new Hono();
  lazyApp.get('/v1/canvas-snapshot', async (c) => {
    const state = await getState();
    const snap = state.getLatestSnapshot();
    if (!snap) {
      return c.json({ activeTemplateId: 'ask-anything', widgets: [] });
    }
    return c.json({
      activeTemplateId: snap.activeTemplateId,
      widgets: snap.widgets.map((w) => ({
        id: w.id,
        kind: w.kind,
        role: w.role,
        title: w.title,
        // summary trimmed: full payloads are exposed via POST.
        summary:
          typeof w.payload['body'] === 'string'
            ? (w.payload['body'] as string).slice(0, 200)
            : '',
      })),
    });
  });
  lazyApp.post('/v1/canvas-snapshot', async (c) => {
    const state = await getState();
    const body = (await c.req.json().catch(() => ({}))) as { id?: string };
    if (!body.id) return c.json({ error: 'id is required' }, 400);
    const snap = state.getLatestSnapshot();
    const widget = snap?.widgets.find((w) => w.id === body.id);
    if (!widget) return c.json({ error: 'widget not found' }, 404);
    return c.json(widget);
  });
  app.route('/', lazyApp);
}

/**
 * Static SPA serving for the public demo build. Mounted last so /v1/*
 * routes still match first. Looks for app/dist/index.html relative to
 * the running module — present after `pnpm app:build` runs. In
 * Electron + dev we never reach this branch because the renderer is
 * loaded directly by Vite or Electron's loadFile; only the Railway
 * deploy uses it.
 */
async function maybeWireStaticSpa(): Promise<void> {
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, join } = await import('node:path');
  // dist-backend/server.js → ../../app/dist (compiled). src/backend/server.ts
  // → ../../app/dist (dev). Either way the prefix is two levels up.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../app/dist'),
    join(here, '../app/dist'),
    join(here, 'app/dist'),
  ];
  const root = candidates.find((p) => existsSync(join(p, 'index.html')));
  if (!root) {
    console.log('[opencanvas backend] no app/dist found — SPA not served');
    return;
  }
  const { serveStatic } = await import('@hono/node-server/serve-static');
  // Files at the root of dist (assets/*, favicons, og-image)
  app.use('/*', serveStatic({ root, precompressed: true }));
  // SPA fallback: any unmatched GET that wasn't a /v1/* route → index.html
  // so deep-link reloads don't 404. Hono's app.get('*') runs after the
  // static middleware misses.
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/v1/')) return c.notFound();
    const indexPath = join(root, 'index.html');
    const { readFileSync } = await import('node:fs');
    return c.html(readFileSync(indexPath, 'utf8'));
  });
  console.log(`[opencanvas backend] serving SPA from ${root}`);
}

export async function start(port: number): Promise<void> {
  const { serve } = await import('@hono/node-server');
  const s = await getState();
  // Prime the auth token before we begin accepting requests. Reads/creates
  // ~/.opencanvas/auth-token. The path is logged (but never the token) so
  // operators know where to grab it for curl use. Skipped in demo mode
  // where auth is disabled anyway.
  if (!isDemoMode()) void getAuthToken();
  await maybeWireStaticSpa();
  // Railway / containers expect us to listen on 0.0.0.0 + read $PORT.
  // Local dev keeps 127.0.0.1 so loopback-only binding still holds.
  const hostname = isDemoMode() || process.env['HOST'] === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
  serve({ fetch: app.fetch, port, hostname });
  console.log(`[opencanvas backend] listening on http://${hostname}:${port}`);
  console.log(`[opencanvas backend] profile: ${s.profileName}`);
  console.log(`[opencanvas backend] llm:     ${s.getLLMProvider().id}`);
  console.log(`[opencanvas backend] embed:   ${s.getEmbedder().id}`);
  if (isDemoMode()) {
    console.log(`[opencanvas backend] DEMO MODE — auth disabled, CORS open, rate limit on /v1/chat`);
  } else if (process.env['OPENCANVAS_REQUIRE_AUTH'] !== '0') {
    console.log(`[opencanvas backend] auth:    token at ${getAuthTokenPath()}`);
  } else {
    console.log(`[opencanvas backend] auth:    DISABLED (OPENCANVAS_REQUIRE_AUTH=0)`);
  }
}

// Run via `pnpm tsx src/backend/server.ts` or `pnpm backend`.
// We detect this by checking process.argv[1] against the resolved module URL.
import { fileURLToPath } from 'node:url';
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  // Port resolution order:
  //   1. PORT — Railway / Heroku / Fly / Render / generic PaaS convention
  //   2. OPENCANVAS_BACKEND_PORT — explicit override used by Electron
  //   3. 3457 — local dev default
  const port = Number(
    process.env['PORT'] ?? process.env['OPENCANVAS_BACKEND_PORT'] ?? 3457,
  );
  start(port).catch((e) => {
    console.error('[opencanvas backend] fatal:', e);
    process.exit(1);
  });
}

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

// CORS: the Vite dev server proxies /v1/* to this backend (same-origin from
// the browser's POV) so CORS is technically not needed in dev. We mirror the
// request origin anyway as a belt-and-braces measure for direct curl/SDK use
// from other localhost ports. Safe for localhost-only deployments.
app.use('/*', cors({ origin: (o) => o, allowMethods: ['GET', 'POST', 'OPTIONS'] }));

let statePromise: Promise<BackendState> | null = null;

export function getState(): Promise<BackendState> {
  if (!statePromise) statePromise = BackendState.create();
  return statePromise;
}

// Health
app.get('/v1/health', async (c) => {
  const state = await getState();
  return c.json({
    ok: true,
    profile: state.profileName,
    llm: state.getLLMProvider().id,
    embedder: state.getEmbedder().id,
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
{
  const lazyApp = new Hono();
  lazyApp.post('/v1/chat', async (c) => {
    const state = await getState();
    const sub = chatRoute(state);
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

export async function start(port: number): Promise<void> {
  const { serve } = await import('@hono/node-server');
  const s = await getState();
  serve({ fetch: app.fetch, port });
  console.log(`[opencanvas backend] listening on http://127.0.0.1:${port}`);
  console.log(`[opencanvas backend] profile: ${s.profileName}`);
  console.log(`[opencanvas backend] llm:     ${s.getLLMProvider().id}`);
  console.log(`[opencanvas backend] embed:   ${s.getEmbedder().id}`);
}

// Run via `pnpm tsx src/backend/server.ts` or `pnpm backend`.
// We detect this by checking process.argv[1] against the resolved module URL.
import { fileURLToPath } from 'node:url';
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = Number(process.env['OPENCANVAS_BACKEND_PORT'] ?? 3457);
  start(port).catch((e) => {
    console.error('[opencanvas backend] fatal:', e);
    process.exit(1);
  });
}

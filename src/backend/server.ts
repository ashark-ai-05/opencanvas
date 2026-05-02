import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { cors } from 'hono/cors';
import { BackendState } from './state.js';
import { healthRoute } from './routes/health.js';
import { queryOpenAIRoute } from './routes/query-openai.js';

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

// CORS: allow the space-agent frontend (default :3456) to call our backend (:3457).
// Mirror the request origin — safe for localhost-only deployments.
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

export async function start(port: number): Promise<void> {
  const { serve } = await import('@hono/node-server');
  const s = await getState();
  serve({ fetch: app.fetch, port });
  console.log(`[llm-wiki backend] listening on http://127.0.0.1:${port}`);
  console.log(`[llm-wiki backend] profile: ${s.profileName}`);
  console.log(`[llm-wiki backend] llm:     ${s.getLLMProvider().id}`);
  console.log(`[llm-wiki backend] embed:   ${s.getEmbedder().id}`);
}

// Run via `pnpm tsx src/backend/server.ts` or `pnpm backend`.
// We detect this by checking process.argv[1] against the resolved module URL.
import { fileURLToPath } from 'node:url';
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = Number(process.env['LLM_WIKI_BACKEND_PORT'] ?? 3457);
  start(port).catch((e) => {
    console.error('[llm-wiki backend] fatal:', e);
    process.exit(1);
  });
}

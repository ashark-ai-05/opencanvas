import { Hono } from 'hono';
import type { BackendState } from '../state.js';

export function sourcesRoute(state: BackendState): Hono {
  const r = new Hono();

  // List configured sources (without connecting). For runtime status,
  // hit /v1/sources/probe.
  r.get('/v1/sources', (c) => {
    return c.json({
      sources: state.profile.sources.map((s) => ({
        id: s.id,
        name: s.name,
        transport: s.transport,
      })),
    });
  });

  // Connect every source and return health + tool count.
  r.get('/v1/sources/probe', async (c) => {
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

  // List tools for one source (connecting on-demand).
  r.get('/v1/sources/:id/tools', async (c) => {
    const id = c.req.param('id');
    const config = state.profile.sources.find((s) => s.id === id);
    if (!config) return c.json({ error: `unknown source: ${id}` }, 404);

    const { createMcpClient } = await import('../../mcp/transport.js');
    const { MCPSource } = await import('../../mcp/source.js');
    const client = await createMcpClient(config);
    const source = new MCPSource(config.id, config.name, client);
    try {
      await source.introspect();
      return c.json({
        id: source.id,
        name: source.name,
        tools: source.tools,
      });
    } finally {
      await source.close();
    }
  });

  // Call a single tool. Body: { args: <json> }.
  r.post('/v1/sources/:id/tools/:tool', async (c) => {
    const id = c.req.param('id');
    const toolName = c.req.param('tool');
    const config = state.profile.sources.find((s) => s.id === id);
    if (!config) return c.json({ error: `unknown source: ${id}` }, 404);

    const body = (await c.req.json().catch(() => ({}))) as { args?: unknown };

    const { createMcpClient } = await import('../../mcp/transport.js');
    const { MCPSource } = await import('../../mcp/source.js');
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

  return r;
}

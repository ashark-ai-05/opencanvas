import { Hono } from 'hono';
import type { BackendState } from '../state.js';

export function embedRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/embed', async (c) => {
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

  return r;
}

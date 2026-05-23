import { Hono } from 'hono';
import type { BackendState } from '../state.js';

export function healthRoute(state: BackendState): Hono {
  const r = new Hono();
  r.get('/v1/health', (c) =>
    c.json({
      ok: true,
      profile: state.profileName,
      llm: state.getLLMProvider().id,
      embedder: state.getEmbedder().id,
    })
  );
  return r;
}

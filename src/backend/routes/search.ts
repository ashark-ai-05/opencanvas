import { Hono } from 'hono';
import type { BackendState } from '../state.js';
import { SearchService } from '../../search/service.js';
import { titleFromUri } from '../../search/title.js';
import type { ResultKind } from '../../core/source.js';

type Result = {
  id: string;
  sourceId: string;
  kind: ResultKind;
  shape: Record<string, unknown>;
  provenance: { uri: string; fetchedAt: number };
  freshness: { ttlMs?: number };
  links: [];
};

export function searchRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/search', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      query?: string;
      limit?: number;
    };
    const query = (body.query ?? '').trim();
    if (!query) {
      return c.json({ error: 'query is required' }, 400);
    }

    const store = await state.getStore();
    const embedder = state.getEmbedder();
    const service = new SearchService({ store, embedder });
    const limit = Math.max(1, Math.min(50, Number(body.limit ?? 10)));

    const hits = await service.search(query, limit);

    // The agent-shape hits already include kind, source, title, snippet, score.
    // For shape we still need the full payload (body + meta) so we hydrate via
    // fetchById per hit. Cheap by-id lookup; no caching needed at this scale.
    const results: Result[] = [];
    for (const h of hits) {
      const full = await service.fetchById(h.id);
      if (!full) continue;
      const payload = full.payload as { body?: string; uri?: string } & Record<string, unknown>;
      const body = typeof payload.body === 'string' ? payload.body : '';
      const uri = typeof payload.uri === 'string' ? payload.uri : '';
      const kind = h.kind as ResultKind;
      results.push({
        id: h.id,
        sourceId: h.source,
        kind,
        shape: shapeForKind(kind, body, uri, payload),
        provenance: { uri, fetchedAt: Date.now() },
        freshness: {},
        links: [],
      });
    }

    return c.json({ results });
  });

  return r;
}

function shapeForKind(
  kind: ResultKind,
  body: string,
  uri: string,
  meta: Record<string, unknown>
): Record<string, unknown> {
  // Best-effort mapping — the frontend dispatcher knows the shape format
  // for each widget. Keep these aligned with the props each ShapeUtil
  // declares in app/src/canvas/shapes/*.tsx.
  if (kind === 'code-symbol' || kind === 'code-file') {
    return {
      symbolName: typeof meta['symbolName'] === 'string' ? meta['symbolName'] : undefined,
      filePath: typeof meta['file'] === 'string' ? meta['file'] : titleFromUri(uri),
      language: typeof meta['language'] === 'string' ? meta['language'] : undefined,
      // tldraw shape prop is `code` (matches agent payload field name).
      code: body,
    };
  }
  if (kind === 'text-document' || kind === 'wiki-page') {
    return {
      title: titleFromUri(uri),
      body,
    };
  }
  // Fallback — KeyValueCard renders these.
  return {
    title: titleFromUri(uri),
    fields: [
      { key: 'kind', value: kind },
      { key: 'uri', value: uri },
      { key: 'body', value: body.slice(0, 200) + (body.length > 200 ? '…' : '') },
    ],
  };
}

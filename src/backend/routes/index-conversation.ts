import { Hono } from 'hono';
import type { BackendState } from '../state.js';

/**
 * POST /v1/index-conversation
 *
 * Strata's compounding-value mechanic: every chat turn that completes
 * gets chunked + embedded into the same SQLite store the document/code
 * indexers use. After enough use, search_kb naturally surfaces hits
 * from your prior conversations alongside hits from your docs/code.
 *
 * Request body:
 *   { conversationId: string, messages: UIMessage[] }
 *
 * Response:
 *   { ok: true, indexed: number, sourceId: string }
 *
 * Idempotent — re-indexing the same conversation replaces prior chunks
 * (the indexer uses (source_id, uri) as the dedup key).
 */
export function indexConversationRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/index-conversation', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      conversationId?: string;
      messages?: Array<{
        id?: string;
        role?: string;
        parts?: Array<{ type?: string; text?: string }>;
      }>;
    };

    const conversationId = (body.conversationId ?? '').trim();
    if (!conversationId) {
      return c.json({ error: 'conversationId is required' }, 400);
    }
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (messages.length === 0) {
      return c.json({ ok: true, indexed: 0, sourceId: '' });
    }

    // Build a single document per [user, assistant] pair. Each pair becomes
    // one chunk in the index — small enough to be a single search hit, big
    // enough to carry the question and the answer together.
    const pairs: { uri: string; body: string }[] = [];
    let pendingUser: string | null = null;
    let pairIndex = 0;
    for (const m of messages) {
      const text = (m.parts ?? [])
        .filter((p) => p.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join(' ')
        .trim();
      if (!text) continue;
      if (m.role === 'user') {
        pendingUser = text;
      } else if (m.role === 'assistant' && pendingUser) {
        pairs.push({
          uri: `conversation://${conversationId}/turn/${pairIndex}`,
          body: `Q: ${pendingUser}\n\nA: ${text}`,
        });
        pendingUser = null;
        pairIndex++;
      }
    }
    if (pairs.length === 0) {
      return c.json({ ok: true, indexed: 0, sourceId: '' });
    }

    const sourceId = `conversation:${conversationId}`;
    const store = await state.getStore();
    const embedder = state.getEmbedder();

    // Embed all bodies in one batch (single ONNX inference is cheap; per-call
    // overhead dominates).
    const vectors = await embedder.embed(pairs.map((p) => p.body));
    const embedderId = embedder.id;
    const now = Date.now();

    // Idempotent replace: count prior chunks for this conversation before
    // we nuke them, so we can return an accurate delta (new chunks - old
    // chunks) instead of the raw insertion count. The frontend KB badge
    // bumps by `delta` so re-indexing a 3-turn → 5-turn conversation
    // increments the header by 2, not 5.
    const priorCountRow = store.db
      .prepare(`SELECT COUNT(*) AS c FROM chunks WHERE source_id = ?`)
      .get(sourceId) as { c: number } | undefined;
    const priorCount = priorCountRow?.c ?? 0;

    store.db
      .prepare(`DELETE FROM chunks WHERE source_id = ?`)
      .run(sourceId);

    const insertChunk = store.db.prepare(
      `INSERT INTO chunks (source_id, kind, uri, body, meta_json, embedder_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertEmbedding = store.db.prepare(
      `INSERT INTO embeddings (chunk_id, embedding) VALUES (?, ?)`,
    );

    const txn = store.db.transaction(() => {
      for (let i = 0; i < pairs.length; i++) {
        const p = pairs[i]!;
        const meta = JSON.stringify({
          conversationId,
          turnIndex: i,
          title: `Conversation turn ${i + 1}`,
        });
        const result = insertChunk.run(
          sourceId,
          'chat-message',
          p.uri,
          p.body,
          meta,
          embedderId,
          now,
        );
        // sqlite-vec's vec0 virtual table rejects JS `number` for the rowid
        // binding even though chunks.id is INTEGER — bind as BigInt to match
        // what the document/code indexers do.
        const chunkId = BigInt(result.lastInsertRowid as bigint | number);
        insertEmbedding.run(chunkId, Buffer.from(vectors[i]!.buffer));
      }
    });
    txn();

    return c.json({
      ok: true,
      indexed: pairs.length,
      // Net delta vs prior state. Drives the header KB badge animation.
      // Negative when a conversation gets shorter (rare — likely never
      // happens given we only append assistant turns); the frontend
      // clamps to >=0.
      delta: pairs.length - priorCount,
      sourceId,
    });
  });

  return r;
}

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { BackendState } from '../state.js';

export function queryRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/query', async (c) => {
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

  return r;
}

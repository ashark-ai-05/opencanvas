import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { providerEventsToOpenAI } from '../openai-stream.js';
import type { BackendState } from '../state.js';

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | { type: string; text?: string }[];
};

function extractText(content: OpenAIMessage['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
  }
  return '';
}

export function queryOpenAIRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/query/openai', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      messages?: OpenAIMessage[];
      stream?: boolean;
    };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'messages must be a non-empty array' }, 400);
    }

    // Find the last user turn → that's the prompt.
    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      return c.json({ error: 'at least one user message is required' }, 400);
    }
    const prompt = extractText(lastUser.content);

    // Extract any system message (use the LAST one if multiple).
    const systemMsg = [...body.messages].reverse().find((m) => m.role === 'system');
    const systemPrompt = systemMsg ? extractText(systemMsg.content) : undefined;

    return streamSSE(c, async (stream) => {
      const provider = state.getLLMProvider();
      const events = provider.query({ prompt, systemPrompt });
      for await (const sseLine of providerEventsToOpenAI(events)) {
        // stream.write accepts raw string — sseLine already includes
        // `data: ...\n\n` framing so we bypass writeSSE's extra framing.
        await stream.write(sseLine);
      }
    });
  });

  return r;
}

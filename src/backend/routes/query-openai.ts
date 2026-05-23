import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { providerEventsToOpenAI } from '../openai-stream.js';
import type { BackendState } from '../state.js';

type ContentBlock = { type: string; text?: string };
type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  // Legacy / cURL shape: a string or array of {type,text}
  content?: string | ContentBlock[];
  // AI SDK 6 useChat shape: array of {type,text} parts, no top-level content
  parts?: ContentBlock[];
};

function extractText(message: OpenAIMessage): string {
  const blocks = message.parts ?? message.content;
  if (typeof blocks === 'string') return blocks;
  if (Array.isArray(blocks)) {
    return blocks
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
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
    const prompt = extractText(lastUser);
    if (!prompt.trim()) {
      return c.json({ error: 'last user message has no text content' }, 400);
    }

    // Extract any system message (use the LAST one if multiple).
    const systemMsg = [...body.messages].reverse().find((m) => m.role === 'system');
    const systemPrompt = systemMsg ? extractText(systemMsg) : undefined;

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

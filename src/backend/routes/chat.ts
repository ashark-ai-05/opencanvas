import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { providerEventsToUIMS, UIMS_HEADERS } from '../uims-stream.js';
import { parseCanvasSnapshot } from '../../agent/canvas-snapshot.js';
import type { BackendState } from '../state.js';

/**
 * Browser-facing chat route — speaks the AI SDK 6 UI Message Stream
 * protocol (NOT OpenAI chat-completions). Used by the React app's
 * `useChat` hook via `DefaultChatTransport`.
 *
 * For OpenAI-compatible clients (curl, OpenAI SDK), use /v1/query/openai.
 */

type ContentBlock = { type: string; text?: string };
type UIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | ContentBlock[];
  parts?: ContentBlock[];
};

function extractText(message: UIChatMessage): string {
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

export function chatRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/chat', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      messages?: UIChatMessage[];
      canvasSnapshot?: unknown;
    };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'messages must be a non-empty array' }, 400);
    }

    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      return c.json({ error: 'at least one user message is required' }, 400);
    }
    const prompt = extractText(lastUser);
    if (!prompt.trim()) {
      return c.json({ error: 'last user message has no text content' }, 400);
    }

    const systemMsg = [...body.messages].reverse().find((m) => m.role === 'system');
    const systemPrompt = systemMsg ? extractText(systemMsg) : undefined;
    // parseCanvasSnapshot is permissive: undefined / malformed input falls
    // back to EMPTY_SNAPSHOT so a missing snapshot never 400s a chat turn.
    const canvasSnapshot = parseCanvasSnapshot(body.canvasSnapshot);

    // Apply UIMS headers BEFORE entering streamSSE so DefaultChatTransport
    // recognises the protocol on first byte.
    for (const [k, v] of Object.entries(UIMS_HEADERS)) c.header(k, v);

    return stream(c, async (s) => {
      // Mirror the request's underlying signal into a fresh AbortController
      // owned by this turn, so the provider sees an AbortSignal it can
      // forward to the SDK without us exposing the raw request internals.
      const abortController = new AbortController();
      c.req.raw.signal.addEventListener(
        'abort',
        () => abortController.abort(),
        { once: true },
      );

      const provider = state.getLLMProvider();
      const events = provider.query({
        prompt,
        systemPrompt,
        canvasSnapshot,
        abortSignal: abortController.signal,
      });
      for await (const sseLine of providerEventsToUIMS(events)) {
        await s.write(sseLine);
      }
    });
  });

  return r;
}

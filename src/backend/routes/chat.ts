import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { providerEventsToUIMS, UIMS_HEADERS } from '../uims-stream.js';
import { parseCanvasSnapshot } from '../../agent/canvas-snapshot.js';
import type { BackendState } from '../state.js';
import type { HistoryMessage, ProviderEvent } from '../../core/provider.js';

/**
 * Browser-facing chat route — speaks the AI SDK 6 UI Message Stream
 * protocol (NOT OpenAI chat-completions). Used by the React app's
 * `useChat` hook via `DefaultChatTransport`.
 *
 * For OpenAI-compatible clients (curl, OpenAI SDK), use /v1/query/openai.
 *
 * Per-turn lifecycle (spec §10.C):
 *   1. Last user message → `prompt`. Earlier user/assistant turns become
 *      `HistoryMessage[]`; system messages are concatenated into
 *      `systemPrompt`. Tool / unknown roles are dropped.
 *   2. `state.getSessionId(conversationId)` rehydrates a prior native session
 *      (Claude SDK / Amp). When the provider emits `session-started`, we
 *      intercept it and persist the new id via `state.setSessionId`.
 *   3. The latest canvas snapshot is mirrored into `state.setLatestSnapshot`
 *      so the out-of-process MCP server (Amp profile) can serve `read_canvas`
 *      without a round-trip to the browser.
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

/**
 * Walk the messages array (oldest → newest) and split into:
 *   - `systemPrompt`: concatenated system messages
 *   - `history`: every user/assistant turn EXCEPT the last user one
 *   - `prompt`: the last user message's text
 *
 * Tool / unknown role messages are silently dropped.
 */
function splitMessages(messages: UIChatMessage[]): {
  prompt: string;
  history: HistoryMessage[];
  systemPrompt: string | undefined;
} {
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') return i;
    }
    return -1;
  })();

  let systemPrompt = '';
  const history: HistoryMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (i === lastUserIdx) continue;
    const m = messages[i];
    if (!m) continue;
    const text = extractText(m);
    if (!text.trim()) continue;
    if (m.role === 'system') {
      systemPrompt = systemPrompt ? `${systemPrompt}\n\n${text}` : text;
    } else if (m.role === 'user' || m.role === 'assistant') {
      history.push({ role: m.role, content: text });
    }
  }

  const last = messages[lastUserIdx];
  return {
    prompt: last ? extractText(last) : '',
    history,
    systemPrompt: systemPrompt.length > 0 ? systemPrompt : undefined,
  };
}

export function chatRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/chat', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      messages?: UIChatMessage[];
      canvasSnapshot?: unknown;
      conversationId?: string;
    };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'messages must be a non-empty array' }, 400);
    }

    const { prompt, history, systemPrompt } = splitMessages(body.messages);
    if (!prompt.trim()) {
      return c.json({ error: 'last user message has no text content' }, 400);
    }

    // parseCanvasSnapshot is permissive: undefined / malformed input falls
    // back to EMPTY_SNAPSHOT so a missing snapshot never 400s a chat turn.
    const canvasSnapshot = parseCanvasSnapshot(body.canvasSnapshot);
    state.setLatestSnapshot(canvasSnapshot);

    const conversationId = body.conversationId ?? '';
    const priorSessionId = conversationId
      ? state.getSessionId(conversationId)
      : undefined;

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
        history,
        sessionId: priorSessionId,
        canvasSnapshot,
        abortSignal: abortController.signal,
      });

      // Wrap the provider stream so we can sniff session-started events
      // without consuming or reordering them — UIMS swallows it but the
      // chat route must persist the id for the next turn's `resume:`.
      async function* tap(): AsyncIterable<ProviderEvent> {
        for await (const ev of events) {
          if (ev.type === 'session-started' && conversationId) {
            state.setSessionId(conversationId, ev.sessionId);
          }
          yield ev;
        }
      }

      for await (const sseLine of providerEventsToUIMS(tap())) {
        await s.write(sseLine);
      }
    });
  });

  return r;
}

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { providerEventsToUIMS, UIMS_HEADERS } from '../uims-stream.js';
import { parseCanvasSnapshot } from '../../agent/canvas-snapshot.js';
import { WidgetStreamBus } from '../../agent/widget-stream-bus.js';
import { buildPreferencesHint } from '../../agent/preferences-hint.js';
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
      userPreferences?: {
        byKind?: Record<
          string,
          { placed: number; deleted: number; pinned: number }
        >;
      };
    };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'messages must be a non-empty array' }, 400);
    }

    const { prompt, history, systemPrompt: rawSystemPrompt } = splitMessages(body.messages);
    // Append the preferences hint to whatever system prompt the
    // upstream messages provided. Hint is empty when there's no
    // signal yet (new conversation), so this is safe to always run.
    const prefHint = buildPreferencesHint(body.userPreferences);
    const systemPrompt = prefHint
      ? rawSystemPrompt
        ? `${rawSystemPrompt}\n\n${prefHint}`
        : prefHint
      : rawSystemPrompt;
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

      // Per-turn widget-stream bus — see ARCHITECTURE in widget-stream-bus.ts.
      // The agent's `stream_widget` tool emits start/op/end events on
      // this bus. We drain them in parallel with the provider stream
      // and write data-widget-stream-* parts onto the same SSE.
      const bus = new WidgetStreamBus();
      // Track widget-ids the bus owns so /v1/cancel-stream/:id can find
      // the right bus to cancel against.
      const ownedWidgetIds = new Set<string>();

      const provider = state.getLLMProvider();
      const notebookStore = state.getNotebookStore
        ? await state.getNotebookStore().catch(() => undefined)
        : undefined;
      const events = provider.query({
        prompt,
        systemPrompt,
        history,
        sessionId: priorSessionId,
        canvasSnapshot,
        abortSignal: abortController.signal,
        streamBus: bus,
        widgetRegistry: state.getWidgetRegistry(),
        notebookStore,
      });

      // Wrap the provider stream so we can sniff session-started events
      // without consuming or reordering them — UIMS swallows it but the
      // chat route must persist the id for the next turn's `resume:`.
      async function* tapProvider(): AsyncIterable<ProviderEvent> {
        for await (const ev of events) {
          if (ev.type === 'session-started' && conversationId) {
            state.setSessionId(conversationId, ev.sessionId);
          }
          yield ev;
        }
      }

      // Drain provider stream and bus concurrently. When provider
      // finishes, close the bus (which lets `for-await-of bus` end).
      const providerDone = (async () => {
        try {
          for await (const sseLine of providerEventsToUIMS(tapProvider())) {
            await s.write(sseLine);
          }
        } finally {
          // Best-effort: if any tool is still streaming when the
          // provider stream ends, give it 200ms to drain naturally
          // before forcing the bus closed. Most streams complete
          // before/right when the provider's tool-call returns.
          if (!bus.isIdle()) {
            await new Promise((r) => setTimeout(r, 200));
          }
          bus.close();
        }
      })();

      const busDone = (async () => {
        for await (const event of bus) {
          if (event.kind === 'start') {
            ownedWidgetIds.add(event.id);
            state.registerStreamWidget(event.id, bus);
            await s.write(
              `data: ${JSON.stringify({
                type: 'data-widget-stream-start',
                id: `wstream-start-${event.id}`,
                data: {
                  id: event.id,
                  kind: event.widgetKind,
                  role: event.role,
                  scaffold: event.scaffold,
                },
              })}\n\n`,
            );
          } else if (event.kind === 'op') {
            await s.write(
              `data: ${JSON.stringify({
                type: 'data-widget-stream-op',
                id: `wstream-op-${event.id}-${event.seq}`,
                data: { id: event.id, seq: event.seq, op: event.op },
              })}\n\n`,
            );
          } else {
            const data: Record<string, unknown> = {
              id: event.id,
              ok: event.ok,
            };
            if (event.error) data['error'] = event.error;
            await s.write(
              `data: ${JSON.stringify({
                type: 'data-widget-stream-end',
                id: `wstream-end-${event.id}`,
                data,
              })}\n\n`,
            );
            state.unregisterStreamWidget(event.id);
            ownedWidgetIds.delete(event.id);
          }
        }
      })();

      try {
        await Promise.all([providerDone, busDone]);
      } finally {
        // Defensive: clear any still-registered ids (e.g. provider
        // crashed mid-stream so end was never emitted).
        for (const id of ownedWidgetIds) state.unregisterStreamWidget(id);
      }
    });
  });

  /**
   * Cancel an in-flight streaming widget by id. The tool handler
   * polls `bus.isCancelled(id)` between ops and stops early when it
   * sees true; the bus then emits a stream-end with `ok=false,
   * error='cancelled by user'`. Returns 404 if the id isn't tracked
   * (already complete, or never started).
   */
  r.post('/v1/cancel-stream/:id', async (c) => {
    const id = c.req.param('id');
    if (!id) return c.json({ ok: false, error: 'missing id' }, 400);
    const cancelled = state.cancelStreamWidget(id);
    return c.json({ ok: cancelled });
  });

  return r;
}

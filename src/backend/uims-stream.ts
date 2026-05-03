import type { ProviderEvent } from '../core/provider.js';

/**
 * AI SDK UI Message Stream protocol — v1.
 *
 * Spec (from `ai@^6` `UI_MESSAGE_STREAM_HEADERS` + `UIMessageChunk`):
 *   header: `x-vercel-ai-ui-message-stream: v1`
 *   body  : SSE, each event is `data: <json-chunk>\n\n`, terminated by `data: [DONE]`.
 *
 * Bracketing for a single text reply:
 *   start → start-step → text-start{id} → text-delta{id, delta}* → text-end{id}
 *         → finish-step → finish → [DONE]
 *
 * Reasoning ("thinking") deltas use the parallel `reasoning-*` family — we
 * forward them too so the UI can render thinking when the active provider
 * exposes it (Claude Opus adaptive thinking).
 */
export const UIMS_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  'x-vercel-ai-ui-message-stream': 'v1',
  'x-accel-buffering': 'no',
} as const;

export async function* providerEventsToUIMS(
  events: AsyncIterable<ProviderEvent>
): AsyncIterable<string> {
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const textId = `t0`;
  const reasoningId = `r0`;

  function emit(chunk: Record<string, unknown>): string {
    return `data: ${JSON.stringify(chunk)}\n\n`;
  }

  yield emit({ type: 'start', messageId });
  yield emit({ type: 'start-step' });

  // Lazy-open text/reasoning brackets — only emit `*-start` once we
  // actually see a delta of that kind. Saves an empty text-part if the
  // model only produces thinking, or vice versa.
  let textOpen = false;
  let reasoningOpen = false;

  try {
    for await (const event of events) {
      switch (event.type) {
        case 'text-delta':
          if (!event.text) break;
          if (!textOpen) {
            yield emit({ type: 'text-start', id: textId });
            textOpen = true;
          }
          yield emit({ type: 'text-delta', id: textId, delta: event.text });
          break;

        case 'thinking-delta':
          if (!event.text) break;
          if (!reasoningOpen) {
            yield emit({ type: 'reasoning-start', id: reasoningId });
            reasoningOpen = true;
          }
          yield emit({ type: 'reasoning-delta', id: reasoningId, delta: event.text });
          break;

        case 'tool-call': {
          // Dev-time diagnostic: log every tool call so backend logs show
          // turn-by-turn what the agent is doing. Cheap to print, invaluable
          // when chasing max_turns / spin-loop bugs.
          const inputSnippet = (() => {
            try {
              const s = JSON.stringify(event.input);
              return s.length > 120 ? `${s.slice(0, 120)}…` : s;
            } catch {
              return '<unserializable>';
            }
          })();
          console.log(`[uims-stream] tool-call ${event.name} ${inputSnippet}`);
          // Top-level chunk — does NOT close any open text/reasoning bracket.
          // Agent loops often interleave tool calls inside a single text stream
          // ("let me search…" → tool-call → continue same text); cutting the
          // bracket would cause the UI to start a new text part and stutter.
          yield emit({
            type: 'tool-input-available',
            toolCallId: event.toolCallId,
            toolName: event.name,
            input: event.input,
          });
          break;
        }

        case 'tool-result':
          // Symmetric with tool-call: top-level, never closes text/reasoning.
          if (event.isError) {
            const errorText =
              typeof event.output === 'string'
                ? event.output
                : JSON.stringify(event.output);
            console.log(`[uims-stream] tool-error ${event.name}: ${errorText.slice(0, 160)}`);
            yield emit({
              type: 'tool-output-error',
              toolCallId: event.toolCallId,
              errorText,
            });
          } else {
            yield emit({
              type: 'tool-output-available',
              toolCallId: event.toolCallId,
              output: event.output,
            });
          }
          break;

        case 'error':
          // UIMS has a first-class error chunk — the client surfaces this
          // via useChat's `error` state instead of silently truncating.
          if (textOpen) yield emit({ type: 'text-end', id: textId });
          if (reasoningOpen) yield emit({ type: 'reasoning-end', id: reasoningId });
          textOpen = false;
          reasoningOpen = false;
          console.error('[uims-stream] provider error:', event.message);
          yield emit({ type: 'error', errorText: event.message });
          yield emit({ type: 'finish-step' });
          yield emit({ type: 'finish', finishReason: 'error' });
          yield 'data: [DONE]\n\n';
          return;

        case 'done':
          // Fall through to the post-loop cleanup so brackets close once.
          break;
      }
    }

    if (textOpen) yield emit({ type: 'text-end', id: textId });
    if (reasoningOpen) yield emit({ type: 'reasoning-end', id: reasoningId });
    yield emit({ type: 'finish-step' });
    yield emit({ type: 'finish', finishReason: 'stop' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[uims-stream] generator threw:', message);
    if (textOpen) yield emit({ type: 'text-end', id: textId });
    if (reasoningOpen) yield emit({ type: 'reasoning-end', id: reasoningId });
    yield emit({ type: 'error', errorText: message });
    yield emit({ type: 'finish-step' });
    yield emit({ type: 'finish', finishReason: 'error' });
  }

  yield 'data: [DONE]\n\n';
}

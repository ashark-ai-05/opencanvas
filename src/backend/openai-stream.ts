import type { ProviderEvent } from '../core/provider.js';

const MODEL_LABEL = 'opencanvas';

/**
 * Convert our ProviderEvent stream into OpenAI chat-completions SSE
 * chunks. Each yielded string is a complete SSE block ready to write
 * directly to the response (already includes trailing `\n\n`).
 */
export async function* providerEventsToOpenAI(
  events: AsyncIterable<ProviderEvent>
): AsyncIterable<string> {
  const id = `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const created = Math.floor(Date.now() / 1000);

  function chunk(delta: Record<string, unknown>, finishReason?: string): string {
    const payload: Record<string, unknown> = {
      id,
      object: 'chat.completion.chunk',
      created,
      model: MODEL_LABEL,
      choices: [
        {
          index: 0,
          delta,
          ...(finishReason ? { finish_reason: finishReason } : {}),
        },
      ],
    };
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  // Opening chunk: assistant role
  yield chunk({ role: 'assistant', content: '' });

  for await (const event of events) {
    switch (event.type) {
      case 'text-delta':
        if (event.text) yield chunk({ content: event.text });
        break;
      case 'done':
        yield chunk({}, 'stop');
        break;
      case 'error':
        // Best-effort: log to stderr; consumers see the truncated stream.
        // OpenAI's spec doesn't define an in-stream error chunk that all
        // consumers handle; we rely on HTTP-level errors before the
        // stream starts and graceful truncation otherwise.
        console.error('[openai-stream] provider error:', event.message);
        yield chunk({}, 'stop');
        break;
      // reasoning-delta, tool-input, tool-result, session-started are
      // intentionally dropped — OpenAI's chat-completions schema has no
      // standard slot for them.
    }
  }

  yield 'data: [DONE]\n\n';
}

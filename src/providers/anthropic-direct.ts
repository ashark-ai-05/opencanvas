/**
 * AnthropicDirectAdapter — uses @anthropic-ai/sdk directly with an API key.
 *
 * Auth: ANTHROPIC_API_KEY environment variable (required).
 * No OAuth — direct-API OAuth is not available to third-party apps per
 * the Feb 2026 ToS. Use ClaudeAgentSdkAdapter for OAuth.
 *
 * Streams messages using the extended thinking + adaptive thinking feature.
 */
import type { LLMProvider, ProviderEvent, QueryRequest, ProbeResult } from '../core/provider.js';
import { renderHistoryBlock } from './history-helpers.js';

export type AnthropicDirectConfig = {
  model?: string;
};

const DEFAULT_MODEL = 'claude-opus-4-7';

export class AnthropicDirectAdapter implements LLMProvider {
  readonly id = 'anthropic-direct';
  readonly name = 'Anthropic Direct';
  readonly kind = 'model' as const;

  constructor(private readonly config: AnthropicDirectConfig = {}) {}

  async *query(request: QueryRequest): AsyncIterable<ProviderEvent> {
    if (!process.env['ANTHROPIC_API_KEY']) {
      yield {
        type: 'error',
        message: 'ANTHROPIC_API_KEY is not set. Set it in your environment or .env file.',
      };
      yield { type: 'done' };
      return;
    }

    // Dynamic import for lazy loading
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();
    const model = this.config.model ?? DEFAULT_MODEL;

    // Anthropic's `messages` API doesn't expose a session id, so prior
    // turns must be sent inline. Map history → role'd messages; rawPrompt
    // skips both the system prompt and the history.
    const historyMessages = (request.history ?? []).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const messages = [
      ...historyMessages,
      { role: 'user' as const, content: request.prompt },
    ];

    const systemPrompt = request.rawPrompt
      ? request.systemPrompt
      : request.systemPrompt;
    const historyBlock = request.rawPrompt
      ? ''
      : renderHistoryBlock(request.history);
    const composedSystem = [systemPrompt, historyBlock]
      .filter((s): s is string => Boolean(s && s.length > 0))
      .join('\n\n');

    try {
      const stream = client.messages.stream({
        model,
        max_tokens: 16000,
        ...(request.rawPrompt ? {} : { thinking: { type: 'adaptive' as const } }),
        messages,
        ...(composedSystem.length > 0 ? { system: composedSystem } : {}),
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield { type: 'text-delta', text: event.delta.text };
        } else if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'thinking_delta'
        ) {
          yield { type: 'reasoning-delta', text: event.delta.thinking };
        }
      }

      const finalMessage = await stream.finalMessage();
      yield {
        type: 'done',
        usage: {
          inputTokens: finalMessage.usage.input_tokens,
          outputTokens: finalMessage.usage.output_tokens,
        },
      };
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      yield { type: 'done' };
    }
  }

  async probe(): Promise<ProbeResult> {
    if (!process.env['ANTHROPIC_API_KEY']) {
      return { ok: false, error: 'ANTHROPIC_API_KEY not set' };
    }
    const start = Date.now();
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic();
      // Minimal probe: list models (cheap, no token cost)
      await client.models.list({ limit: 1 });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

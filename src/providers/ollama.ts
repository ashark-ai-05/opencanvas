/**
 * OllamaAdapter — runs against a local Ollama server.
 *
 * Auth: none (local). Requires Ollama to be running on localhost:11434
 * (or whatever baseUrl is configured).
 *
 * Uses the `ollama` npm package for typed API access.
 */
import type { LLMProvider, ProviderEvent, QueryRequest, ProbeResult } from '../core/provider.js';

export type OllamaConfig = {
  model?: string;
  baseUrl?: string;
};

const DEFAULT_MODEL = 'llama3.2';
const DEFAULT_BASE_URL = 'http://localhost:11434';

export class OllamaAdapter implements LLMProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama';
  readonly kind = 'model' as const;

  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: OllamaConfig = {}) {
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  }

  async *query(request: QueryRequest): AsyncIterable<ProviderEvent> {
    try {
      const { Ollama } = await import('ollama');
      const client = new Ollama({ host: this.baseUrl });

      const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      messages.push({ role: 'user', content: request.prompt });

      const stream = await client.chat({
        model: this.model,
        messages,
        stream: true,
      });

      let inputTokens: number | undefined;
      let outputTokens: number | undefined;

      for await (const chunk of stream) {
        if (chunk.message.content) {
          yield { type: 'text-delta', text: chunk.message.content };
        }
        if (chunk.done && chunk.eval_count !== undefined) {
          inputTokens = chunk.prompt_eval_count;
          outputTokens = chunk.eval_count;
        }
      }

      yield {
        type: 'done',
        usage: { inputTokens, outputTokens },
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
    const start = Date.now();
    try {
      const { Ollama } = await import('ollama');
      const client = new Ollama({ host: this.baseUrl });
      await client.list();
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

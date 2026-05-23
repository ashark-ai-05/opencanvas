/**
 * OpenAIAdapter — uses the `openai` npm package against api.openai.com.
 *
 * Auth: OPENAI_API_KEY environment variable (required).
 * Default model: gpt-4o (latest stable without date suffix).
 */
import type { LLMProvider, ProviderEvent, QueryRequest, ProbeResult } from '../core/provider.js';

export type OpenAIConfig = {
  model?: string;
  baseURL?: string;
  apiKeyEnvVar?: string;
};

const DEFAULT_MODEL = 'gpt-4o';

export class OpenAIAdapter implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly kind = 'model' as const;

  private readonly model: string;
  private readonly baseURL: string | undefined;
  private readonly apiKeyEnvVar: string;

  constructor(config: OpenAIConfig = {}, id = 'openai', name = 'OpenAI') {
    this.id = id;
    this.name = name;
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseURL = config.baseURL;
    this.apiKeyEnvVar = config.apiKeyEnvVar ?? 'OPENAI_API_KEY';
  }

  private getApiKey(): string | undefined {
    return process.env[this.apiKeyEnvVar];
  }

  async *query(request: QueryRequest): AsyncIterable<ProviderEvent> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      yield {
        type: 'error',
        message: `${this.apiKeyEnvVar} is not set. Set it in your environment or .env file.`,
      };
      yield { type: 'done' };
      return;
    }

    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({
      apiKey,
      ...(this.baseURL ? { baseURL: this.baseURL } : {}),
    });

    try {
      const messages: Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
      }> = [];
      if (request.systemPrompt) {
        messages.push({ role: 'system', content: request.systemPrompt });
      }
      // History: forward role'd messages so the model has full conversational
      // context. Skipped under rawPrompt — the QA enricher wants a flat call.
      if (!request.rawPrompt) {
        for (const m of request.history ?? []) {
          messages.push({ role: m.role, content: m.content });
        }
      }
      messages.push({ role: 'user', content: request.prompt });

      const stream = client.chat.completions.stream({
        model: this.model,
        messages,
        stream: true,
      });

      let inputTokens: number | undefined;
      let outputTokens: number | undefined;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          yield { type: 'text-delta', text: delta.content };
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens;
          outputTokens = chunk.usage.completion_tokens;
        }
      }

      const finalCompletion = await stream.finalChatCompletion();
      if (finalCompletion.usage) {
        inputTokens = finalCompletion.usage.prompt_tokens;
        outputTokens = finalCompletion.usage.completion_tokens;
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
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return { ok: false, error: `${this.apiKeyEnvVar} not set` };
    }
    const start = Date.now();
    try {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({
        apiKey,
        ...(this.baseURL ? { baseURL: this.baseURL } : {}),
      });
      await client.models.list();
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

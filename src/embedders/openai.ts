import OpenAI from 'openai';
import type {
  EmbeddingProvider,
  EmbeddingProbeResult,
} from '../core/embedding-provider.js';

const MODEL_DIMS: Record<string, number> = {
  'text-embedding-3-small': 1536,
  'text-embedding-3-large': 3072,
};

export type OpenAIEmbedderOptions = {
  model?: string;
  apiKey?: string;
};

export class OpenAIEmbedder implements EmbeddingProvider {
  readonly id: string;
  readonly name = 'OpenAI';
  readonly dims: number;
  readonly capabilities = { batchSize: 100, offline: false };

  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIEmbedderOptions = {}) {
    this.model = options.model ?? 'text-embedding-3-small';
    this.dims = MODEL_DIMS[this.model] ?? 1536;
    this.id = `openai:${this.model}`;
    this.client = new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY });
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
    });
    return response.data.map((d) => Float32Array.from(d.embedding));
  }

  async probe(): Promise<EmbeddingProbeResult> {
    if (!process.env.OPENAI_API_KEY) {
      return { ok: false, error: 'OPENAI_API_KEY not set' };
    }
    const t0 = performance.now();
    try {
      const v = await this.embed(['probe']);
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - t0),
        dims: v[0].length,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

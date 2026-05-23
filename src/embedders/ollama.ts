import type {
  EmbeddingProvider,
  EmbeddingProbeResult,
} from '../core/embedding-provider.js';

const MODEL_DIMS: Record<string, number> = {
  'nomic-embed-text': 768,
  'mxbai-embed-large': 1024,
};

export type OllamaEmbedderOptions = {
  model?: string;
  baseUrl?: string;
};

export class OllamaEmbedder implements EmbeddingProvider {
  readonly id: string;
  readonly name = 'Ollama';
  readonly dims: number;
  readonly capabilities = { batchSize: 1, offline: true };

  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: OllamaEmbedderOptions = {}) {
    this.model = options.model ?? 'nomic-embed-text';
    this.dims = MODEL_DIMS[this.model] ?? 768;
    this.id = `ollama:${this.model}`;
    this.baseUrl = options.baseUrl ?? 'http://localhost:11434';
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (const text of texts) {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      if (!response.ok) {
        throw new Error(
          `Ollama API error ${response.status}: ${await response.text()}`
        );
      }
      const json = (await response.json()) as { embedding: number[] };
      out.push(Float32Array.from(json.embedding));
    }
    return out;
  }

  async probe(): Promise<EmbeddingProbeResult> {
    const t0 = performance.now();
    try {
      const v = await this.embed(['probe']);
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - t0),
        dims: v[0].length,
      };
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof Error
            ? `${e.message} (is Ollama running at ${this.baseUrl}?)`
            : String(e),
      };
    }
  }
}

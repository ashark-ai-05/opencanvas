import type {
  EmbeddingProvider,
  EmbeddingProbeResult,
} from '../core/embedding-provider.js';

const MODEL_DIMS: Record<string, number> = {
  'voyage-3': 1024,
  'voyage-3-large': 1024,
  'voyage-code-3': 1024,
};

export type VoyageEmbedderOptions = {
  model?: string;
  apiKey?: string;
};

export class VoyageEmbedder implements EmbeddingProvider {
  readonly id: string;
  readonly name = 'Voyage';
  readonly dims: number;
  readonly capabilities = { batchSize: 128, offline: false };

  private readonly model: string;
  private readonly apiKey: string | undefined;

  constructor(options: VoyageEmbedderOptions = {}) {
    this.model = options.model ?? 'voyage-3';
    this.dims = MODEL_DIMS[this.model] ?? 1024;
    this.id = `voyage:${this.model}`;
    this.apiKey = options.apiKey ?? process.env.VOYAGE_API_KEY;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!this.apiKey) throw new Error('VOYAGE_API_KEY not set');

    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    });

    if (!response.ok) {
      throw new Error(
        `Voyage API error ${response.status}: ${await response.text()}`
      );
    }

    const json = (await response.json()) as {
      data: { embedding: number[] }[];
    };
    return json.data.map((d) => Float32Array.from(d.embedding));
  }

  async probe(): Promise<EmbeddingProbeResult> {
    if (!this.apiKey) return { ok: false, error: 'VOYAGE_API_KEY not set' };
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

import type {
  EmbeddingProvider,
  EmbeddingProbeResult,
} from '../core/embedding-provider.js';

type Pipeline = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array }>;

type BundledOnnxOptions = {
  /** HuggingFace model id. Default: BAAI/bge-small-en-v1.5 (384-dim). */
  model?: string;
};

export class BundledOnnxEmbedder implements EmbeddingProvider {
  readonly id: string;
  readonly name = 'Bundled ONNX';
  readonly dims = 384;
  readonly capabilities = { batchSize: 32, offline: true };

  private readonly modelId: string;
  private extractorPromise: Promise<Pipeline | null> | null = null;
  private fallbackWarned = false;

  constructor(options: BundledOnnxOptions = {}) {
    this.modelId = options.model ?? 'BAAI/bge-small-en-v1.5';
    this.id = `onnx-bundled:${this.modelId}`;
  }

  private async getExtractor(): Promise<Pipeline | null> {
    if (!this.extractorPromise) {
      this.extractorPromise = (async () => {
        try {
          const transformers = await import('@huggingface/transformers');
          // Cache models locally; allow remote fetch on first run.
          transformers.env.allowRemoteModels = true;
          const extractor = await transformers.pipeline(
            'feature-extraction',
            this.modelId,
          );
          return extractor as unknown as Pipeline;
        } catch (err) {
          // Loading the bundled ONNX model can fail when:
          //   - No network on first run + no local cache present
          //   - HF cache is corrupt / partial download
          //   - Sandbox blocks crypto/wasm SIMD that transformers.js needs
          // Search would 500 every request without fallback. Degrade
          // to a deterministic zero-vector embedder so the rest of the
          // app (chat, indexing, FTS5 keyword search) keeps working;
          // vector ranking just contributes 0 to RRF until the model
          // can be loaded. Retried on next process restart.
          console.error(
            '[bundled-onnx] failed to load embedder model — falling back to zero-vector mode (FTS5 keyword search still works):',
            err instanceof Error ? err.message : err,
          );
          return null;
        }
      })();
    }
    return this.extractorPromise;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const extractor = await this.getExtractor();
    if (!extractor) {
      // Zero-vector fallback. Same dim as the live model so nothing
      // downstream needs branching. Logged once per process so the
      // operator notices but the agent loop doesn't spam.
      if (!this.fallbackWarned) {
        console.warn(
          `[bundled-onnx] returning zero vectors for ${texts.length} text(s) — install/cache ${this.modelId} or switch to OPENAI/voyage embedder for real semantic search.`,
        );
        this.fallbackWarned = true;
      }
      return texts.map(() => new Float32Array(this.dims));
    }
    const out: Float32Array[] = [];
    for (const text of texts) {
      const result = await extractor(text, { pooling: 'mean', normalize: true });
      out.push(result.data);
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
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

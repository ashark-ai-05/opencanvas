import { describe, it, expect } from 'vitest';
import type {
  EmbeddingProvider,
  EmbeddingProbeResult,
} from '../src/core/embedding-provider.js';
import { BundledOnnxEmbedder } from '../src/embedders/bundled-onnx.js';

class FakeEmbedder implements EmbeddingProvider {
  readonly id = 'fake';
  readonly name = 'Fake';
  readonly dims = 4;
  readonly capabilities = { batchSize: 8, offline: true };
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => {
      const v = new Float32Array(this.dims);
      for (let i = 0; i < this.dims; i++) v[i] = (t.charCodeAt(i % t.length) || 0) / 128;
      return v;
    });
  }
  async probe(): Promise<EmbeddingProbeResult> {
    return { ok: true, latencyMs: 0, dims: this.dims };
  }
}

describe('EmbeddingProvider', () => {
  it('embeds a batch and returns one vector per text', async () => {
    const e = new FakeEmbedder();
    const out = await e.embed(['hello', 'world']);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeInstanceOf(Float32Array);
    expect(out[0].length).toBe(e.dims);
  });

  it('exposes a probe with dims surfaced', async () => {
    const e = new FakeEmbedder();
    const r = await e.probe();
    expect(r.ok).toBe(true);
    expect(r.dims).toBe(4);
  });
});

const runIntegration = process.env.RUN_INTEGRATION === '1';
const itIntegration = runIntegration ? it : it.skip;

describe('BundledOnnxEmbedder (integration)', () => {
  itIntegration(
    'loads the model and produces a 384-d normalized vector',
    async () => {
      const e = new BundledOnnxEmbedder();
      const out = await e.embed(['the quick brown fox']);
      expect(out).toHaveLength(1);
      expect(out[0].length).toBe(384);
      // Mean-pooled + normalized → unit vector
      let norm = 0;
      for (let i = 0; i < out[0].length; i++) norm += out[0][i] * out[0][i];
      expect(Math.sqrt(norm)).toBeCloseTo(1, 3);
    },
    120_000 // first run downloads the model
  );
});

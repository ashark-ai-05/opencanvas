import { pipeline, env } from '@huggingface/transformers';

// Allow remote download for first run (caches in node_modules / HF cache).
// In production, the cached model becomes the bundled artifact.
env.allowRemoteModels = true;

export async function loadEmbedder() {
  const t0 = performance.now();
  const extractor = await pipeline(
    'feature-extraction',
    'BAAI/bge-small-en-v1.5'
  );
  const coldMs = performance.now() - t0;
  return { extractor, coldMs };
}

export async function embed(extractor: any, text: string): Promise<Float32Array> {
  const out = await extractor(text, { pooling: 'mean', normalize: true });
  return out.data as Float32Array;
}

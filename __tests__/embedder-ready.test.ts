import { describe, it, expect, vi } from 'vitest';

vi.mock('@huggingface/transformers', () => ({
  env: { allowRemoteModels: true },
  pipeline: async () => {
    throw new Error('no network');
  },
}));

import { BundledOnnxEmbedder } from '../src/embedders/bundled-onnx.js';

describe('BundledOnnxEmbedder.isReady', () => {
  it('starts false and becomes true after the extractor settles (even on failure)', async () => {
    const e = new BundledOnnxEmbedder({ model: 'test/model' });
    expect(e.isReady()).toBe(false);
    await e.embed(['x']); // forces load → zero-vector fallback
    expect(e.isReady()).toBe(true);
  });
});

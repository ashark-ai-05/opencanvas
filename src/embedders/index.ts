import type { EmbeddingProvider } from '../core/embedding-provider.js';
import type { Profile } from '../config/schema.js';
import { BundledOnnxEmbedder } from './bundled-onnx.js';
import { OpenAIEmbedder } from './openai.js';
import { VoyageEmbedder } from './voyage.js';
import { OllamaEmbedder } from './ollama.js';

export function createEmbedder(profile: Profile): EmbeddingProvider {
  const e = profile.embed;
  switch (e.provider) {
    case 'onnx-bundled':
      return new BundledOnnxEmbedder({ model: e.model });
    case 'openai':
      return new OpenAIEmbedder({ model: e.model });
    case 'voyage':
      return new VoyageEmbedder({ model: e.model });
    case 'ollama':
      return new OllamaEmbedder({ model: e.model, baseUrl: e.baseUrl });
  }
}

/**
 * OpenRouterAdapter — OpenAI-compatible against openrouter.ai.
 *
 * Auth: OPENROUTER_API_KEY environment variable (required).
 * Reuses OpenAIAdapter pointed at OpenRouter's base URL.
 */
import { OpenAIAdapter, type OpenAIConfig } from './openai.js';

export type OpenRouterConfig = {
  model: string;
  baseUrl?: string;
};

export class OpenRouterAdapter extends OpenAIAdapter {
  constructor(config: OpenRouterConfig) {
    const openAIConfig: OpenAIConfig = {
      model: config.model,
      baseURL: config.baseUrl ?? 'https://openrouter.ai/api/v1',
      apiKeyEnvVar: 'OPENROUTER_API_KEY',
    };
    super(openAIConfig, 'openrouter', 'OpenRouter');
  }
}

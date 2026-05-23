/**
 * GroqAdapter — OpenAI-compatible against api.groq.com.
 *
 * Groq runs open-weights models (Llama, Mixtral, Whisper) on their
 * custom inference hardware at very high tokens-per-second. Their free
 * tier has generous rate limits and no $ cap. The API is fully
 * OpenAI-compatible at https://api.groq.com/openai/v1 — same chat
 * completions shape, same streaming protocol — so we just extend the
 * existing OpenAI adapter with a different base URL + auth env var.
 *
 * Auth: GROQ_API_KEY environment variable (required).
 * Default model: llama-3.1-70b-versatile (high-quality, free).
 *
 * Used by the public Railway demo so visitors can talk to the agent
 * without us paying per-call.
 */
import { OpenAIAdapter, type OpenAIConfig } from './openai.js';

export type GroqConfig = {
  model: string;
  baseUrl?: string;
};

export class GroqAdapter extends OpenAIAdapter {
  constructor(config: GroqConfig) {
    const openAIConfig: OpenAIConfig = {
      model: config.model,
      baseURL: config.baseUrl ?? 'https://api.groq.com/openai/v1',
      apiKeyEnvVar: 'GROQ_API_KEY',
    };
    super(openAIConfig, 'groq', 'Groq');
  }
}

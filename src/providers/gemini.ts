/**
 * GeminiAdapter — Google Gemini via its OpenAI-compatible endpoint.
 *
 * Google ships an OpenAI-shaped API at
 * https://generativelanguage.googleapis.com/v1beta/openai that accepts
 * the same chat-completions request body, auth header, and streaming
 * protocol as OpenAI. That means the existing OpenAIAdapter does all
 * the work — we just point it at the new base URL + key env var.
 *
 * Auth: GOOGLE_API_KEY (recommended) or GEMINI_API_KEY (also accepted).
 * Default model: gemini-2.0-flash. The free tier ships ~15 RPM /
 * 1500 RPD on Flash models — plenty for a public demo.
 *
 * Used by the public Railway demo (replaces the earlier Groq choice
 * because Groq blocks signups from a list of regions; Gemini's
 * coverage is broader).
 */
import { OpenAIAdapter, type OpenAIConfig } from './openai.js';

export type GeminiConfig = {
  model: string;
  baseUrl?: string;
};

export class GeminiAdapter extends OpenAIAdapter {
  constructor(config: GeminiConfig) {
    // Both env vars accepted. We expose GOOGLE_API_KEY by default (the
    // name Google itself uses in their AI Studio docs); fall back to
    // GEMINI_API_KEY if that's what the operator has set.
    const apiKeyEnvVar = process.env['GOOGLE_API_KEY']
      ? 'GOOGLE_API_KEY'
      : process.env['GEMINI_API_KEY']
        ? 'GEMINI_API_KEY'
        : 'GOOGLE_API_KEY';
    const openAIConfig: OpenAIConfig = {
      model: config.model,
      baseURL:
        config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKeyEnvVar,
    };
    super(openAIConfig, 'gemini', 'Gemini');
  }
}

/**
 * Resolves an OpenCanvas profile to a Vercel AI SDK `LanguageModel`.
 *
 * This is the unified-agent path's replacement for `src/providers/index.ts`.
 * Instead of dispatching to a custom `LLMProvider` implementation, we hand
 * back a model instance the AI SDK can drive directly via `streamText`,
 * which handles tool-calling, streaming, and provider quirks once.
 *
 * Each branch lazy-imports its provider package so a user that runs
 * OpenCanvas on Gemini doesn't pay startup cost for the Anthropic SDK
 * (and vice-versa). Models are returned synchronously after the dynamic
 * import resolves.
 *
 * See docs/plans/unified-agent.md (Phase 2) for the migration shape.
 */
import type { LanguageModel } from 'ai';
import type { Profile } from '../config/schema.js';

export async function resolveAiSdkModel(profile: Profile): Promise<LanguageModel> {
  const llm = profile.llm;

  switch (llm.provider) {
    case 'anthropic-direct':
    case 'claude-agent-sdk': {
      // claude-agent-sdk falls through to the same model wiring as
      // anthropic-direct under v2 — the SDK's bespoke runtime is the
      // thing being removed, not the model itself. Default model for
      // claude-agent-sdk literal is undefined so we pick a sensible
      // current Claude model when missing.
      const { anthropic } = await import('@ai-sdk/anthropic');
      const model = (llm as { model?: string }).model ?? 'claude-sonnet-4-6';
      return anthropic(model);
    }

    case 'openai': {
      const { openai } = await import('@ai-sdk/openai');
      return openai(llm.model);
    }

    case 'gemini': {
      // We use the @ai-sdk/google adapter, which talks to Gemini's native
      // API surface (NOT the OpenAI-compat shim at /v1beta/openai).
      // The native surface has cleaner tool-call streaming.
      //
      // The SDK reads `GOOGLE_GENERATIVE_AI_API_KEY` by default, but
      // OpenCanvas accepts the more common `GOOGLE_API_KEY` (what AI
      // Studio's UI suggests) and `GEMINI_API_KEY`. Resolve here and
      // pass explicitly so any of the three env vars works.
      const apiKey =
        process.env['GOOGLE_GENERATIVE_AI_API_KEY'] ??
        process.env['GOOGLE_API_KEY'] ??
        process.env['GEMINI_API_KEY'];
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const provider = createGoogleGenerativeAI(apiKey ? { apiKey } : {});
      return provider(llm.model);
    }

    case 'groq': {
      const { groq } = await import('@ai-sdk/groq');
      return groq(llm.model);
    }

    case 'openrouter': {
      const { openrouter } = await import('@openrouter/ai-sdk-provider');
      return openrouter(llm.model);
    }

    case 'ollama': {
      const { createOllama } = await import('ollama-ai-provider-v2');
      const provider = createOllama({ baseURL: llm.baseUrl });
      return provider(llm.model);
    }

    case 'amp': {
      // Amp speaks its own MCP-based protocol. It's not driven by streamText.
      // The chat route checks for amp upstream and dispatches to the legacy
      // path; reaching here means a misconfiguration.
      throw new Error(
        'Amp provider is not driven by the AI SDK model resolver. ' +
          'The chat route should detect amp upstream and use the legacy path.',
      );
    }

    default: {
      // Exhaustiveness check — adding a new literal to ProfileSchema.llm
      // without handling it here is a compile error.
      const _exhaustive: never = llm;
      throw new Error(
        `Unknown LLM provider: ${JSON.stringify(_exhaustive)}. ` +
          'Add a case in src/agent/model-resolver.ts.',
      );
    }
  }
}

/**
 * Lookup table of which env var the SDK provider expects for credentials.
 * Used at boot to surface a friendly error before the first chat turn
 * blows up with a cryptic "missing API key" from the provider package.
 */
export function getProviderApiKeyEnvVar(profile: Profile): string | null {
  const llm = profile.llm;
  switch (llm.provider) {
    case 'anthropic-direct':
    case 'claude-agent-sdk':
      return 'ANTHROPIC_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'gemini':
      // @ai-sdk/google reads GOOGLE_GENERATIVE_AI_API_KEY by default.
      // GOOGLE_API_KEY is also accepted by Google's SDK; we suggest both.
      return process.env['GOOGLE_GENERATIVE_AI_API_KEY']
        ? 'GOOGLE_GENERATIVE_AI_API_KEY'
        : 'GOOGLE_API_KEY';
    case 'groq':
      return 'GROQ_API_KEY';
    case 'openrouter':
      return 'OPENROUTER_API_KEY';
    case 'ollama':
      // Local; no key.
      return null;
    case 'amp':
      return null;
    default: {
      const _exhaustive: never = llm;
      void _exhaustive;
      return null;
    }
  }
}

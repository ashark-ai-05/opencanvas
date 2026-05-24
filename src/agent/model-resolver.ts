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

/**
 * Provider-options shape — `Record<provider-name, Record<option, JSON value>>`.
 * Mirrors AI SDK's `SharedV3ProviderOptions` (which is unexported from `ai`
 * in v6). Passed through to `streamText({ providerOptions })`.
 *
 * We type the inner values as `any` so callers can build provider-specific
 * shapes without fighting JSONObject's recursive type; the SDK runtime
 * still enforces JSON serializability at the wire boundary.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProviderOptionsRecord = Record<string, Record<string, any>>;

export interface ResolvedModel {
  model: LanguageModel;
  /**
   * Provider-specific options. Today this carries thinking/reasoning config
   * for models that support it (Anthropic's extended thinking, Google's
   * Gemini 2.5+ thinkingConfig). Surfaces reasoning deltas to the client
   * so the `ShowThinking` chat panel has something to display.
   */
  providerOptions?: ProviderOptionsRecord;
}

/**
 * Heuristic: which model ids support emitting thoughts/reasoning?
 *
 * - Gemini 2.5+ Flash and Pro families
 * - Gemini 3+
 * - Anthropic Claude Sonnet/Opus 4+ (when extended thinking is enabled)
 */
function geminiSupportsThinking(model: string): boolean {
  // 2.5+ flash/pro support thinking; 2.0 and earlier don't.
  // -lite variants in 2.5 also support it.
  if (/^gemini-2\.5/.test(model)) return true;
  if (/^gemini-3/.test(model)) return true;
  if (/^gemini-(flash|pro)-(latest|lite-latest)/.test(model)) {
    // The "-latest" aliases route to the newest version, which supports it.
    // EXCEPT: gemini-flash-lite-latest is currently aliased to a 2.5-lite
    // variant that DOES support thinking — confirmed against API responses.
    return true;
  }
  return false;
}

export async function resolveAiSdkModel(profile: Profile): Promise<LanguageModel> {
  const { model } = await resolveAiSdkModelWithOptions(profile);
  return model;
}

/**
 * Per-request overrides — used by the BYO-key path in chat.ts handleV2
 * when the user passes their own API key via the `X-OpenCanvas-Api-Key`
 * header. The override is scoped to this single resolve call; nothing
 * is mutated globally (no process.env stomping).
 */
export interface ResolveOverrides {
  /** Explicit API key for this request. Wins over the env var. */
  apiKey?: string;
}

export async function resolveAiSdkModelWithOptions(
  profile: Profile,
  overrides: ResolveOverrides = {},
): Promise<ResolvedModel> {
  const llm = profile.llm;
  const overrideKey = overrides.apiKey?.trim();

  switch (llm.provider) {
    case 'anthropic-direct':
    case 'claude-agent-sdk': {
      // claude-agent-sdk falls through to the same model wiring as
      // anthropic-direct under v2 — the SDK's bespoke runtime is the
      // thing being removed, not the model itself. Default model for
      // claude-agent-sdk literal is undefined so we pick a sensible
      // current Claude model when missing.
      const modelId = (llm as { model?: string }).model ?? 'claude-sonnet-4-6';
      const supportsThinking = /claude-(sonnet|opus)-4/.test(modelId);
      const { anthropic, createAnthropic } = await import('@ai-sdk/anthropic');
      const provider = overrideKey ? createAnthropic({ apiKey: overrideKey }) : anthropic;
      return {
        model: provider(modelId),
        ...(supportsThinking
          ? {
              providerOptions: {
                anthropic: {
                  thinking: { type: 'enabled', budgetTokens: 2048 },
                },
              } as ProviderOptionsRecord,
            }
          : {}),
      };
    }

    case 'openai': {
      const { openai, createOpenAI } = await import('@ai-sdk/openai');
      const provider = overrideKey ? createOpenAI({ apiKey: overrideKey }) : openai;
      return { model: provider(llm.model) };
    }

    case 'gemini': {
      // @ai-sdk/google reads GOOGLE_GENERATIVE_AI_API_KEY by default;
      // OpenCanvas also accepts GOOGLE_API_KEY and GEMINI_API_KEY (env
      // var alternatives common in the wild). Per-request override
      // (BYO-key header from the settings menu) wins over all of these.
      const envKey =
        process.env['GOOGLE_GENERATIVE_AI_API_KEY'] ??
        process.env['GOOGLE_API_KEY'] ??
        process.env['GEMINI_API_KEY'];
      const apiKey = overrideKey ?? envKey;
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const provider = createGoogleGenerativeAI(apiKey ? { apiKey } : {});
      // Enable thinking on Gemini 2.5+/3.x and the "-latest" aliases.
      // includeThoughts: true surfaces the model's reasoning as
      // `reasoning` parts in the UIMS stream, which our ShowThinking
      // panel renders. budget=2048 keeps token spend bounded.
      const supportsThinking = geminiSupportsThinking(llm.model);
      return {
        model: provider(llm.model),
        ...(supportsThinking
          ? {
              providerOptions: {
                google: {
                  thinkingConfig: {
                    includeThoughts: true,
                    thinkingBudget: 2048,
                  },
                },
              } as ProviderOptionsRecord,
            }
          : {}),
      };
    }

    case 'groq': {
      const { groq, createGroq } = await import('@ai-sdk/groq');
      const provider = overrideKey ? createGroq({ apiKey: overrideKey }) : groq;
      return { model: provider(llm.model) };
    }

    case 'openrouter': {
      const { openrouter, createOpenRouter } = await import('@openrouter/ai-sdk-provider');
      const provider = overrideKey ? createOpenRouter({ apiKey: overrideKey }) : openrouter;
      return { model: provider(llm.model) };
    }

    case 'ollama': {
      const { createOllama } = await import('ollama-ai-provider-v2');
      const provider = createOllama({ baseURL: llm.baseUrl });
      return { model: provider(llm.model) };
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

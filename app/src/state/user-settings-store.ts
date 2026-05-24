/**
 * Per-browser LLM settings: provider, model, API key.
 *
 * Lets a visitor on the public Railway demo override the server-side
 * default (Gemini Flash Lite Latest on a shared free-tier key) with
 * their own model + key. Keys stay in localStorage — we never POST
 * them to the backend for storage. They ride on every /v1/chat request
 * as `X-OpenCanvas-Provider`, `X-OpenCanvas-Model`, and
 * `X-OpenCanvas-Api-Key` headers; the backend uses them just for that
 * one request, then discards.
 *
 * Why no server persistence:
 *   - Storing user API keys = liability. Browser-only = lower attack
 *     surface.
 *   - Public demo is the primary BYO-key consumer; per-browser is the
 *     right scope.
 *   - When per-user accounts ship (later), the same store + per-user
 *     server-side preferences can coexist — the header still wins.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Supported providers — matches the literals in
 * `src/config/schema.ts`'s ProfileSchema and the model-resolver switch.
 */
export const USER_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'groq',
  'openrouter',
  'ollama',
] as const;

export type UserProvider = (typeof USER_PROVIDERS)[number];

/**
 * Maps a UserProvider (the user-facing label we expose in the settings
 * UI) to the OPENCANVAS_LLM_PROVIDER literal the backend understands.
 * Most are the same name; google → gemini for legacy reasons (the
 * profile literal in the schema is 'gemini' though @ai-sdk/google is
 * how we connect).
 */
export const PROVIDER_TO_SCHEMA_LITERAL: Record<UserProvider, string> = {
  anthropic: 'anthropic-direct',
  openai: 'openai',
  google: 'gemini',
  groq: 'groq',
  openrouter: 'openrouter',
  ollama: 'ollama',
};

/**
 * Default model suggestions per provider. Used as placeholders in the
 * settings modal — the user can override. Picked to be free-tier
 * friendly where possible.
 */
export const PROVIDER_DEFAULT_MODELS: Record<UserProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  google: 'gemini-flash-lite-latest',
  groq: 'llama-3.3-70b-versatile',
  openrouter: 'meta-llama/llama-3.3-70b-instruct',
  ollama: 'llama3.2',
};

/**
 * Where the user can grab a free key per provider. Linked from the
 * settings modal to reduce signup friction.
 */
export const PROVIDER_KEY_URLS: Record<UserProvider, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/app/apikey',
  groq: 'https://console.groq.com/keys',
  openrouter: 'https://openrouter.ai/keys',
  ollama: 'https://ollama.com/download',
};

export interface UserSettings {
  /** When set, overrides the server's default LLM for this browser. */
  provider: UserProvider | null;
  /** Model id for the selected provider (e.g. 'claude-sonnet-4-6'). */
  model: string;
  /** API key — stays in localStorage, sent as a header per request. */
  apiKey: string;
}

interface UserSettingsStore extends UserSettings {
  /** True when the user has set their own provider/key — used to gate UI hints. */
  hasOverride: () => boolean;
  /** Partial update — only writes fields that are explicitly set. */
  update: (patch: Partial<UserSettings>) => void;
  /** Wipe back to defaults (no override, server default kicks in). */
  reset: () => void;
}

const EMPTY: UserSettings = { provider: null, model: '', apiKey: '' };

export const useUserSettings = create<UserSettingsStore>()(
  persist(
    (set, get) => ({
      ...EMPTY,
      hasOverride: () => {
        const { provider, apiKey } = get();
        return provider !== null && apiKey.trim().length > 0;
      },
      update: (patch) => set((state) => ({ ...state, ...patch })),
      reset: () => set(EMPTY),
    }),
    {
      name: 'opencanvas:user-settings:v1',
      // Avoid persisting the function fields (Zustand persist serializes
      // the whole state by default; this whitelist keeps things tidy).
      partialize: (state) => ({
        provider: state.provider,
        model: state.model,
        apiKey: state.apiKey,
      }),
    },
  ),
);

/**
 * Build the request headers to attach to /v1/chat (and /v1/team) when
 * the user has provider+model+apiKey set. Returns an empty object when
 * the user is using the server default — caller can spread it into
 * the request headers unconditionally.
 *
 * The values land server-side in `src/backend/routes/chat.ts` (handleV2)
 * where they override the resolved profile.llm + apiKey for that
 * single request.
 */
export function getUserSettingsHeaders(): Record<string, string> {
  const { provider, model, apiKey } = useUserSettings.getState();
  if (!provider || apiKey.trim().length === 0) return {};
  const schemaLiteral = PROVIDER_TO_SCHEMA_LITERAL[provider];
  return {
    'X-OpenCanvas-Provider': schemaLiteral,
    ...(model.trim().length > 0 ? { 'X-OpenCanvas-Model': model.trim() } : {}),
    'X-OpenCanvas-Api-Key': apiKey.trim(),
  };
}

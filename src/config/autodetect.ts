/**
 * First-run model auto-pick.
 *
 * On the very first boot (no ~/.opencanvas/config.json yet) we look for a
 * model the user already has, instead of defaulting to a provider that
 * will reject the first question:
 *   1. an API key already in the environment (Anthropic, OpenAI, Gemini,
 *      Groq, OpenRouter, in that order)
 *   2. a local Ollama at OLLAMA_HOST / localhost:11434 with a pulled model,
 *      preferring families with reliable tool calling
 *   3. otherwise keep the default (claude-agent-sdk, which works when
 *      Claude Code is logged in)
 * Keys are never written to the config, only the provider and model.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_CONFIG, ConfigFileSchema, type ConfigFile } from './schema.js';

export type DetectedLlm =
  | { provider: 'anthropic-direct'; model: string }
  | { provider: 'openai'; model: string }
  | { provider: 'gemini'; model: string }
  | { provider: 'groq'; model: string }
  | { provider: 'openrouter'; model: string }
  | { provider: 'ollama'; model: string; baseUrl: string };

export type Detection = { llm: DetectedLlm; reason: string } | null;

const has = (env: NodeJS.ProcessEnv, k: string) => typeof env[k] === 'string' && env[k]!.trim() !== '';

/** Env-key detection only (sync, no network). */
export function detectFromEnv(env: NodeJS.ProcessEnv = process.env): Detection {
  if (has(env, 'ANTHROPIC_API_KEY'))
    return { llm: { provider: 'anthropic-direct', model: 'claude-sonnet-4-6' }, reason: 'ANTHROPIC_API_KEY is set' };
  if (has(env, 'OPENAI_API_KEY'))
    return { llm: { provider: 'openai', model: 'gpt-4o' }, reason: 'OPENAI_API_KEY is set' };
  for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'])
    if (has(env, k))
      return { llm: { provider: 'gemini', model: 'gemini-flash-lite-latest' }, reason: `${k} is set` };
  if (has(env, 'GROQ_API_KEY'))
    return { llm: { provider: 'groq', model: 'llama-3.3-70b-versatile' }, reason: 'GROQ_API_KEY is set' };
  if (has(env, 'OPENROUTER_API_KEY'))
    return { llm: { provider: 'openrouter', model: 'openrouter/auto' }, reason: 'OPENROUTER_API_KEY is set' };
  return null;
}

/** Families that handle function calling well enough for place_widget. */
const TOOL_FAMILIES = [/^qwen3/, /^qwen2\.5/, /^gpt-oss/, /^llama3\.[1-9]/, /^mistral/, /^llama3/, /^gemma3/];

export function pickOllamaModel(names: string[]): string | null {
  const chat = names.filter((n) => !/embed|bge|minilm|nomic/i.test(n));
  for (const re of TOOL_FAMILIES) {
    const hit = chat.find((n) => re.test(n));
    if (hit) return hit;
  }
  return chat[0] ?? null;
}

export async function detectOllama(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Detection> {
  const raw = env['OLLAMA_HOST']?.trim() || 'http://localhost:11434';
  const baseUrl = (/^https?:\/\//.test(raw) ? raw : `http://${raw}`).replace(/\/$/, '');
  try {
    const res = await fetchImpl(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(800) });
    if (!res.ok) return null;
    const body = (await res.json()) as { models?: { name?: string }[] };
    const model = pickOllamaModel((body.models ?? []).map((m) => m.name ?? '').filter(Boolean));
    if (!model) return null;
    return { llm: { provider: 'ollama', model, baseUrl }, reason: `Ollama is running at ${baseUrl} with ${model}` };
  } catch {
    return null;
  }
}

export async function detectModel(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Detection> {
  return detectFromEnv(env) ?? (await detectOllama(env, fetchImpl));
}

/**
 * If no config exists yet, write one whose active profile uses the detected
 * model (the default claude-sdk profile is kept as a second profile).
 * No-op when a config already exists, when OPENCANVAS_LLM_PROVIDER is set
 * (explicit env choice wins), or when nothing is detected.
 */
export async function ensureFirstRunConfig(
  configPath: string,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<Detection> {
  if (existsSync(configPath) || has(env, 'OPENCANVAS_LLM_PROVIDER')) return null;
  const found = await detectModel(env, fetchImpl);
  if (!found) return null;
  const base = DEFAULT_CONFIG.profiles[0]!;
  const config: ConfigFile = ConfigFileSchema.parse({
    ...DEFAULT_CONFIG,
    activeProfile: 'auto',
    profiles: [{ name: 'auto', llm: found.llm, embed: base.embed, sources: [] }, base],
  });
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return found;
}

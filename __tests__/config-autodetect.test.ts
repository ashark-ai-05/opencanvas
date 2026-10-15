import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectFromEnv,
  detectOllama,
  pickOllamaModel,
  ensureFirstRunConfig,
} from '../src/config/autodetect.js';
import { ConfigFileSchema } from '../src/config/schema.js';

const tags = (names: string[]) =>
  (async () => new Response(JSON.stringify({ models: names.map((name) => ({ name })) }))) as unknown as typeof fetch;
const down = (async () => {
  throw new Error('ECONNREFUSED');
}) as unknown as typeof fetch;

describe('first-run model auto-pick', () => {
  it('prefers env keys in a fixed order and ignores blank values', () => {
    expect(detectFromEnv({ OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' })?.llm.provider).toBe('anthropic-direct');
    expect(detectFromEnv({ GEMINI_API_KEY: 'x' })?.llm.provider).toBe('gemini');
    expect(detectFromEnv({ ANTHROPIC_API_KEY: '  ' })).toBeNull();
    expect(detectFromEnv({})).toBeNull();
  });

  it('picks a tool-capable Ollama model and skips embedding models', () => {
    expect(pickOllamaModel(['nomic-embed-text:latest', 'phi3:mini', 'qwen2.5:7b'])).toBe('qwen2.5:7b');
    expect(pickOllamaModel(['nomic-embed-text'])).toBeNull();
    expect(pickOllamaModel(['phi3:mini'])).toBe('phi3:mini');
  });

  it('detects Ollama via /api/tags and honours OLLAMA_HOST', async () => {
    const d = await detectOllama({ OLLAMA_HOST: '10.0.0.5:11434' }, tags(['llama3.1:8b']));
    expect(d?.llm).toEqual({ provider: 'ollama', model: 'llama3.1:8b', baseUrl: 'http://10.0.0.5:11434' });
    expect(await detectOllama({}, down)).toBeNull();
    expect(await detectOllama({}, tags([]))).toBeNull();
  });

  it('writes a valid config with the detected profile active, without the key', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'oc-auto-')), 'config.json');
    const found = await ensureFirstRunConfig(path, { GROQ_API_KEY: 'secret-groq' }, down);
    expect(found?.llm.provider).toBe('groq');
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('secret-groq');
    const cfg = ConfigFileSchema.parse(JSON.parse(raw));
    expect(cfg.activeProfile).toBe('auto');
    expect(cfg.profiles.map((p) => p.name)).toEqual(['auto', 'claude-sdk']);
  });

  it('never touches an existing config, an explicit env provider, or when nothing is found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oc-auto-'));
    const existing = join(dir, 'config.json');
    writeFileSync(existing, '{}');
    expect(await ensureFirstRunConfig(existing, { OPENAI_API_KEY: 'x' }, down)).toBeNull();
    expect(readFileSync(existing, 'utf8')).toBe('{}');
    const p2 = join(dir, 'b.json');
    expect(await ensureFirstRunConfig(p2, { OPENAI_API_KEY: 'x', OPENCANVAS_LLM_PROVIDER: 'gemini' }, down)).toBeNull();
    expect(await ensureFirstRunConfig(p2, {}, down)).toBeNull();
    expect(existsSync(p2)).toBe(false);
  });
});

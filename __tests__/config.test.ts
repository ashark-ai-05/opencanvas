/**
 * Tests for config schema validation and loader behavior.
 *
 * The loader is tested with a temp file to avoid touching ~/.llm-wiki/config.json.
 * We use environment variable injection to redirect the config path.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigFileSchema, ProfileSchema } from '../src/config/schema.js';
import { loadConfig } from '../src/config/loader.js';

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------

describe('ProfileSchema', () => {
  it('validates a claude-agent-sdk profile', () => {
    const result = ProfileSchema.safeParse({
      name: 'my-claude',
      llm: { provider: 'claude-agent-sdk' },
    });
    expect(result.success).toBe(true);
  });

  it('validates claude-agent-sdk with optional model', () => {
    const result = ProfileSchema.safeParse({
      name: 'my-claude',
      llm: { provider: 'claude-agent-sdk', model: 'claude-opus-4-7' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.llm.provider).toBe('claude-agent-sdk');
    }
  });

  it('validates an openai profile with default model', () => {
    const result = ProfileSchema.safeParse({
      name: 'my-openai',
      llm: { provider: 'openai' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const llm = result.data.llm;
      if (llm.provider === 'openai') {
        expect(llm.model).toBe('gpt-4o');
      }
    }
  });

  it('validates an ollama profile with defaults', () => {
    const result = ProfileSchema.safeParse({
      name: 'local',
      llm: { provider: 'ollama' },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.llm.provider === 'ollama') {
      expect(result.data.llm.model).toBe('llama3.2');
      expect(result.data.llm.baseUrl).toBe('http://localhost:11434');
    }
  });

  it('validates an openrouter profile (model required)', () => {
    const result = ProfileSchema.safeParse({
      name: 'or',
      llm: { provider: 'openrouter', model: 'anthropic/claude-3-5-sonnet' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects openrouter without a model', () => {
    const result = ProfileSchema.safeParse({
      name: 'or',
      llm: { provider: 'openrouter' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown provider', () => {
    const result = ProfileSchema.safeParse({
      name: 'bad',
      llm: { provider: 'foobar' },
    });
    expect(result.success).toBe(false);
  });
});

describe('ConfigFileSchema', () => {
  it('validates a full valid config', () => {
    const config = {
      activeProfile: 'default',
      profiles: [
        { name: 'default', llm: { provider: 'claude-agent-sdk' } },
      ],
    };
    const result = ConfigFileSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('rejects config with empty profiles array', () => {
    const result = ConfigFileSchema.safeParse({
      activeProfile: 'x',
      profiles: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects config missing activeProfile', () => {
    const result = ConfigFileSchema.safeParse({
      profiles: [{ name: 'x', llm: { provider: 'amp' } }],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Config loader tests (using temp files)
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  let tmpDir: string;
  let configPath: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `llm-wiki-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    configPath = join(tmpDir, 'config.json');
    originalEnv = process.env['LLM_WIKI_CONFIG'];
    process.env['LLM_WIKI_CONFIG'] = configPath;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env['LLM_WIKI_CONFIG'];
    } else {
      process.env['LLM_WIKI_CONFIG'] = originalEnv;
    }
  });

  it('writes a default config when file is missing', () => {
    const config = loadConfig();
    expect(config.activeProfile.name).toBe('claude-sdk');
    expect(config.activeProfile.llm.provider).toBe('claude-agent-sdk');
  });

  it('loads a valid config from file', () => {
    const data = {
      activeProfile: 'local',
      profiles: [
        { name: 'local', llm: { provider: 'ollama', model: 'llama3.2' } },
        { name: 'cloud', llm: { provider: 'openai' } },
      ],
    };
    writeFileSync(configPath, JSON.stringify(data));
    const config = loadConfig();
    expect(config.activeProfile.name).toBe('local');
    expect(config.allProfiles).toHaveLength(2);
  });

  it('--profile override selects a different profile', () => {
    const data = {
      activeProfile: 'local',
      profiles: [
        { name: 'local', llm: { provider: 'ollama' } },
        { name: 'cloud', llm: { provider: 'openai' } },
      ],
    };
    writeFileSync(configPath, JSON.stringify(data));
    const config = loadConfig('cloud');
    expect(config.activeProfile.name).toBe('cloud');
    expect(config.activeProfile.llm.provider).toBe('openai');
  });

  it('throws when profile override does not exist', () => {
    const data = {
      activeProfile: 'local',
      profiles: [{ name: 'local', llm: { provider: 'ollama' } }],
    };
    writeFileSync(configPath, JSON.stringify(data));
    expect(() => loadConfig('nonexistent')).toThrow(/profile "nonexistent" not found/);
  });

  it('throws with helpful message on invalid config JSON', () => {
    writeFileSync(configPath, '{ invalid json }');
    expect(() => loadConfig()).toThrow(/not valid JSON/);
  });

  it('throws with helpful message on invalid config shape', () => {
    writeFileSync(configPath, JSON.stringify({ activeProfile: 'x', profiles: [] }));
    expect(() => loadConfig()).toThrow(/config validation failed/);
  });
});

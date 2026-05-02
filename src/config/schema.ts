/**
 * Zod schemas for the llm-wiki config file.
 *
 * Config lives at ~/.llm-wiki/config.json by default, or at the path
 * pointed to by the LLM_WIKI_CONFIG environment variable.
 */
import { z } from 'zod';

export const EmbedProviderSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('onnx-bundled'),
    model: z.string().default('BAAI/bge-small-en-v1.5'),
  }),
  z.object({
    provider: z.literal('openai'),
    model: z.string().default('text-embedding-3-small'),
  }),
  z.object({
    provider: z.literal('voyage'),
    model: z.string().default('voyage-3'),
  }),
  z.object({
    provider: z.literal('ollama'),
    model: z.string().default('nomic-embed-text'),
    baseUrl: z.string().url().default('http://localhost:11434'),
  }),
]);

export const ProfileSchema = z.object({
  name: z.string(),
  llm: z.discriminatedUnion('provider', [
    z.object({
      provider: z.literal('claude-agent-sdk'),
      model: z.string().optional(),
    }),
    z.object({
      provider: z.literal('amp'),
    }),
    z.object({
      provider: z.literal('anthropic-direct'),
      model: z.string().default('claude-opus-4-7'),
    }),
    z.object({
      provider: z.literal('openai'),
      model: z.string().default('gpt-4o'),
    }),
    z.object({
      provider: z.literal('openrouter'),
      model: z.string(),
      baseUrl: z.string().url().default('https://openrouter.ai/api/v1'),
    }),
    z.object({
      provider: z.literal('ollama'),
      model: z.string().default('llama3.2'),
      baseUrl: z.string().url().default('http://localhost:11434'),
    }),
  ]),
  embed: EmbedProviderSchema.default({ provider: 'onnx-bundled', model: 'BAAI/bge-small-en-v1.5' }),
});

export const ConfigFileSchema = z.object({
  activeProfile: z.string(),
  profiles: z.array(ProfileSchema).min(1),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ConfigFile = z.infer<typeof ConfigFileSchema>;

/** Default config written when no config file is found */
export const DEFAULT_CONFIG: ConfigFile = {
  activeProfile: 'claude-sdk',
  profiles: [
    {
      name: 'claude-sdk',
      llm: { provider: 'claude-agent-sdk' },
      embed: { provider: 'onnx-bundled', model: 'BAAI/bge-small-en-v1.5' },
    },
  ],
};

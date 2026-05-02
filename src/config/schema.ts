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

export const SourceConfigSchema = z.discriminatedUnion('transport', [
  z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/, 'id must be kebab/snake-case ASCII'),
    name: z.string(),
    transport: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
  }),
  z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/),
    name: z.string(),
    transport: z.literal('sse'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
  }),
  z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/),
    name: z.string(),
    transport: z.literal('http'),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
  }),
]);

export type SourceConfig = z.infer<typeof SourceConfigSchema>;

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
  sources: z
    .array(SourceConfigSchema)
    .default([])
    .superRefine((sources, ctx) => {
      const seen = new Set<string>();
      for (const s of sources) {
        if (seen.has(s.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate source id: ${s.id}`,
            path: [sources.findIndex((x) => x.id === s.id), 'id'],
          });
        }
        seen.add(s.id);
      }
    }),
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
      sources: [],
    },
  ],
};

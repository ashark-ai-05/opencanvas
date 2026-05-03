/**
 * Provider factory — creates the right LLMProvider instance from a Profile.
 */
import type { LLMProvider } from '../core/provider.js';
import type { Profile } from '../config/schema.js';
import type { AgentToolDeps } from '../agent/tools/index.js';

import { ClaudeAgentSdkAdapter } from './claude-agent-sdk.js';
import { AnthropicDirectAdapter } from './anthropic-direct.js';
import { OpenAIAdapter } from './openai.js';
import { OpenRouterAdapter } from './openrouter.js';
import { OllamaAdapter } from './ollama.js';
import { AmpAdapter } from './amp.js';

/**
 * Optional dependencies passed through to provider adapters.
 * Only `claude-agent-sdk` consumes them today; other adapters ignore
 * `deps` entirely.
 */
export type ProviderDeps = {
  search?: AgentToolDeps['search'];
  webSearch?: AgentToolDeps['webSearch'];
};

export function createProvider(profile: Profile, deps: ProviderDeps = {}): LLMProvider {
  const { llm } = profile;

  switch (llm.provider) {
    case 'claude-agent-sdk':
      return new ClaudeAgentSdkAdapter(
        { model: llm.model },
        { search: deps.search, webSearch: deps.webSearch },
      );

    case 'anthropic-direct':
      return new AnthropicDirectAdapter({ model: llm.model });

    case 'openai':
      return new OpenAIAdapter({ model: llm.model });

    case 'openrouter':
      return new OpenRouterAdapter({ model: llm.model, baseUrl: llm.baseUrl });

    case 'ollama':
      return new OllamaAdapter({ model: llm.model, baseUrl: llm.baseUrl });

    case 'amp':
      return new AmpAdapter();

    default: {
      // Exhaustiveness check
      const _exhaustive: never = llm;
      throw new Error(`Unknown provider: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export {
  ClaudeAgentSdkAdapter,
  AnthropicDirectAdapter,
  OpenAIAdapter,
  OpenRouterAdapter,
  OllamaAdapter,
  AmpAdapter,
};

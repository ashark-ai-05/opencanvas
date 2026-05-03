import { loadConfig } from '../config/loader.js';
import { createProvider } from '../providers/index.js';
import { createEmbedder } from '../embedders/index.js';
import { SourceRegistry } from '../mcp/registry.js';
import { openDefaultStore, type Store } from '../storage/store.js';
import { SearchService } from '../search/service.js';
import type { Profile } from '../config/schema.js';
import type { LLMProvider } from '../core/provider.js';
import type { EmbeddingProvider } from '../core/embedding-provider.js';
import type { AgentToolDeps } from '../agent/tools/index.js';

/**
 * Backend state. Constructed once at server start. Holds the
 * resolved active profile and lazily-instantiated providers.
 *
 * Note: `getLLMProvider()` and `getEmbedder()` are synchronous because
 * provider/embedder construction is itself synchronous (no I/O at ctor time).
 * The MCP source registry is async — call `ensureSourcesConnected()`
 * before using it; subsequent calls are cached.
 */
export class BackendState {
  readonly profile: Profile;
  readonly profileName: string;

  private llmProvider: LLMProvider | null = null;
  private embedder: EmbeddingProvider | null = null;
  private searchAdapter: AgentToolDeps['search'] | null = null;
  private sourceRegistry = new SourceRegistry();
  private sourcesConnectedPromise: Promise<void> | null = null;
  private storePromise: Promise<Store> | null = null;

  private constructor(profile: Profile) {
    this.profile = profile;
    this.profileName = profile.name;
  }

  static async create(): Promise<BackendState> {
    const { activeProfile } = loadConfig();
    return new BackendState(activeProfile);
  }

  getLLMProvider(): LLMProvider {
    if (!this.llmProvider) {
      this.llmProvider = createProvider(this.profile, {
        search: this.getSearchService(),
      });
    }
    return this.llmProvider;
  }

  getEmbedder(): EmbeddingProvider {
    if (!this.embedder) {
      this.embedder = createEmbedder(this.profile);
    }
    return this.embedder;
  }

  /**
   * Returns a stable lazy proxy that satisfies `AgentToolDeps['search']`.
   * The proxy itself is cached; internally each call awaits `getStore()`
   * (which is itself promise-cached) and constructs a fresh SearchService —
   * SearchService is a thin wrapper over store + embedder so this is cheap.
   */
  getSearchService(): AgentToolDeps['search'] {
    if (!this.searchAdapter) {
      this.searchAdapter = {
        search: async (query, limit) => {
          const store = await this.getStore();
          const svc = new SearchService({ store, embedder: this.getEmbedder() });
          return svc.search(query, limit);
        },
        fetchById: async (id) => {
          const store = await this.getStore();
          const svc = new SearchService({ store, embedder: this.getEmbedder() });
          return svc.fetchById(id);
        },
      };
    }
    return this.searchAdapter;
  }

  getSourceRegistry(): SourceRegistry {
    return this.sourceRegistry;
  }

  async getStore(): Promise<Store> {
    if (!this.storePromise) {
      this.storePromise = openDefaultStore();
    }
    return this.storePromise;
  }

  /**
   * Connects every configured source. Idempotent — subsequent calls
   * await the same promise.
   */
  async ensureSourcesConnected(): Promise<void> {
    if (this.sourcesConnectedPromise) {
      return this.sourcesConnectedPromise;
    }
    this.sourcesConnectedPromise = (async () => {
      await this.sourceRegistry.connectAll(this.profile.sources);
    })();
    return this.sourcesConnectedPromise;
  }

  async shutdown(): Promise<void> {
    await this.sourceRegistry.closeAll();
  }
}

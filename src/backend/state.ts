import { loadConfig } from '../config/loader.js';
import { createProvider } from '../providers/index.js';
import { createEmbedder } from '../embedders/index.js';
import { SourceRegistry } from '../mcp/registry.js';
import { openDefaultStore, type Store } from '../storage/store.js';
import { SearchService } from '../search/service.js';
import { createWebSearchProvider } from '../web/tavily.js';
import type { Profile, SourceConfig } from '../config/schema.js';
import type { LLMProvider } from '../core/provider.js';
import type { EmbeddingProvider } from '../core/embedding-provider.js';
import type { AgentToolDeps } from '../agent/tools/index.js';
import type { ExternalMcpSource } from '../providers/claude-agent-sdk.js';
import type { CanvasSnapshot } from '../agent/canvas-snapshot.js';

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
  private webSearchAdapter: AgentToolDeps['webSearch'] | null = null;
  private sourceRegistry = new SourceRegistry();
  private sourcesConnectedPromise: Promise<void> | null = null;
  private storePromise: Promise<Store> | null = null;
  /**
   * Maps `conversationId` → provider-native `sessionId`. Populated when
   * the active provider emits a `session-started` event during a turn;
   * read by the chat route on the next turn to call the SDK with `resume`.
   * In-memory only — backend restart drops the map and the next turn
   * falls back to history-replay rehydration.
   */
  private sessionIds = new Map<string, string>();
  /**
   * Last canvas snapshot the frontend mirrored via `/v1/chat`. The
   * out-of-process OpenCanvas MCP server (Amp profile) reads this to back
   * `read_canvas` / `read_widget` requests without a round-trip to the
   * browser.
   */
  private latestSnapshot: CanvasSnapshot | null = null;

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
        webSearch: this.getWebSearchProvider(),
        getExternalMcpSources: () => this.getExternalMcpSources(),
      });
    }
    return this.llmProvider;
  }

  /**
   * Connects + introspects every configured source so its tools become
   * available to the agent. Cached after first call. Returns SDK-shaped
   * MCP server configs paired with introspected tool names. Failed sources
   * are silently dropped from the result (the CLI's --probe-sources is the
   * place to surface failures, not the chat path).
   */
  async getExternalMcpSources(): Promise<ExternalMcpSource[]> {
    await this.ensureSourcesConnected();
    return this.sourceRegistry.list().map((s) => ({
      name: s.id,
      config: sourceConfigToSdkConfig(
        this.profile.sources.find((c) => c.id === s.id)!,
      ),
      toolNames: s.tools.map((t) => t.name),
    }));
  }

  /**
   * Returns the web search provider — Tavily if TAVILY_API_KEY is set,
   * otherwise an empty-results stub. Cached after first call.
   */
  getWebSearchProvider(): AgentToolDeps['webSearch'] {
    if (!this.webSearchAdapter) {
      this.webSearchAdapter = createWebSearchProvider();
    }
    return this.webSearchAdapter;
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

  /** Look up the provider-native session id for a conversation. */
  getSessionId(conversationId: string): string | undefined {
    return this.sessionIds.get(conversationId);
  }

  /**
   * Persist a session id observed mid-turn. Replaces any prior id for the
   * same conversation. No-op when either input is empty.
   */
  setSessionId(conversationId: string, sessionId: string): void {
    if (!conversationId || !sessionId) return;
    this.sessionIds.set(conversationId, sessionId);
  }

  /** Clear session map for a conversation (e.g. /clear). */
  clearSessionId(conversationId: string): void {
    this.sessionIds.delete(conversationId);
  }

  /**
   * Live widget-stream buses, keyed by widget id. The chat route
   * registers each id when stream-start is emitted; the
   * /v1/cancel-stream/:id route looks the id up here to call
   * `bus.cancel(id)`. Entries are removed when the chat turn that
   * owned the bus completes.
   */
  private streamBusesByWidgetId = new Map<
    string,
    import('../agent/widget-stream-bus.js').WidgetStreamBus
  >();
  registerStreamWidget(
    widgetId: string,
    bus: import('../agent/widget-stream-bus.js').WidgetStreamBus,
  ): void {
    this.streamBusesByWidgetId.set(widgetId, bus);
  }
  unregisterStreamWidget(widgetId: string): void {
    this.streamBusesByWidgetId.delete(widgetId);
  }
  /**
   * Mark a streaming widget as cancelled. Tool handlers poll
   * `bus.isCancelled(id)` between ops and stop early. Returns false
   * when the id isn't tracked (already finished, or never started).
   */
  cancelStreamWidget(widgetId: string): boolean {
    const bus = this.streamBusesByWidgetId.get(widgetId);
    if (!bus) return false;
    bus.cancel(widgetId);
    return true;
  }

  getLatestSnapshot(): CanvasSnapshot | null {
    return this.latestSnapshot;
  }

  setLatestSnapshot(snapshot: CanvasSnapshot | null): void {
    this.latestSnapshot = snapshot;
  }

  async shutdown(): Promise<void> {
    await this.sourceRegistry.closeAll();
  }
}

/**
 * Convert our `SourceConfig` (configured via ~/.opencanvas/config.json) into the
 * shape the Claude Agent SDK's `mcpServers` option expects. The fields are
 * mostly identical; we reshape transport/url/command for the SDK's union.
 */
function sourceConfigToSdkConfig(s: SourceConfig): ExternalMcpSource['config'] {
  // alwaysLoad: true bakes the source's tool schemas into the prompt so the
  // SDK doesn't burn a `ToolSearch` round-trip discovering them every turn.
  // Cost is small (a few hundred prompt tokens per source) — well worth it.
  switch (s.transport) {
    case 'stdio':
      return { type: 'stdio', command: s.command, args: s.args, env: s.env, alwaysLoad: true };
    case 'sse':
      return { type: 'sse', url: s.url, headers: s.headers, alwaysLoad: true };
    case 'http':
      return { type: 'http', url: s.url, headers: s.headers, alwaysLoad: true };
  }
}

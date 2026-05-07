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
import { CanvasEventBus } from './canvas-event-bus.js';
import {
  RefreshScheduler,
  type HttpRefreshSpec,
  type KbRefreshSpec,
  type WebRefreshSpec,
} from './refresh-scheduler.js';
import { WidgetRegistry } from './widget-registry.js';

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

  /**
   * Per-conversation CanvasEventBus registry. Created lazily on first
   * subscribe / first push. External REST callers push directives into
   * the bus; browser SSE subscribers drain.
   *
   * Buses are NOT torn down when the last subscriber closes — events
   * pushed during a "no listener" gap are buffered and delivered on
   * the next subscribe. Memory is bounded by traffic, not subscribers.
   */
  private canvasEventBuses = new Map<string, CanvasEventBus>();
  getCanvasEventBus(conversationId: string): CanvasEventBus {
    let bus = this.canvasEventBuses.get(conversationId);
    if (!bus) {
      bus = new CanvasEventBus();
      this.canvasEventBuses.set(conversationId, bus);
    }
    return bus;
  }
  /**
   * Per-stream sequence counter for external streams (the agent's own
   * stream_widget tool tracks its own seq via WidgetStreamBus). Keyed
   * by widget id; deleted on stream-end. External callers POST ops
   * one at a time without threading their own seq, so the route
   * assigns the next value here.
   */
  private externalStreamSeqs = new Map<string, number>();
  nextExternalStreamSeq(widgetId: string): number {
    const next = (this.externalStreamSeqs.get(widgetId) ?? 0) + 1;
    this.externalStreamSeqs.set(widgetId, next);
    return next;
  }
  endExternalStream(widgetId: string): void {
    this.externalStreamSeqs.delete(widgetId);
  }

  /**
   * Conversation id the browser most-recently said it was looking at.
   * External callers can omit `conversationId` from POSTs and the
   * route falls back to this. Updated by browser via POST /v1/canvas/
   * active-conversation on every conversation switch.
   */
  private activeConversationId: string | null = null;
  setActiveConversationId(id: string | null): void {
    this.activeConversationId = id;
  }
  getActiveConversationId(): string | null {
    return this.activeConversationId;
  }

  /**
   * Refresh scheduler — drives "live" widgets that re-fetch from
   * HTTP / KB / web on a fixed cadence and push 'update' directives
   * via the canvas event bus. Lazily constructed so backends without
   * any live widgets pay no cost.
   */
  private refreshScheduler: RefreshScheduler | null = null;
  getRefreshScheduler(): RefreshScheduler {
    if (this.refreshScheduler) return this.refreshScheduler;
    const sources = {
      http: async (spec: HttpRefreshSpec): Promise<unknown> => {
        const res = await fetch(spec.url, {
          headers: { accept: 'application/json, text/plain;q=0.9, */*;q=0.5' },
        });
        const ct = res.headers.get('content-type') ?? '';
        const raw: unknown = ct.includes('json')
          ? await res.json()
          : await res.text();
        const picked = spec.pick ? pickByPath(raw, spec.pick) : raw;
        if (!spec.into) return picked;
        return setByPath({}, spec.into, picked);
      },
      kb: async (spec: KbRefreshSpec): Promise<unknown> => {
        const search = this.getSearchService();
        const results = await search.search(spec.query, 1);
        if (results.length === 0) return undefined;
        const top = results[0]!;
        const fetched = await search.fetchById(top.id);
        return fetched?.payload ?? { body: top.snippet };
      },
      web: async (spec: WebRefreshSpec): Promise<unknown> => {
        const provider = this.getWebSearchProvider();
        const results = await provider.search(spec.query, 1);
        if (results.length === 0) return undefined;
        return results[0];
      },
    };
    this.refreshScheduler = new RefreshScheduler(sources);
    return this.refreshScheduler;
  }

  getLatestSnapshot(): CanvasSnapshot | null {
    return this.latestSnapshot;
  }

  setLatestSnapshot(snapshot: CanvasSnapshot | null): void {
    this.latestSnapshot = snapshot;
  }

  /**
   * Plugin widget registry. External processes register custom kinds
   * via POST /v1/canvas/widget-kinds; the dispatcher's 'plugin' shape
   * looks them up by name to render via an iframe / web-component /
   * vega-lite descriptor. Single global instance per backend.
   */
  private widgetRegistry: WidgetRegistry | null = null;
  getWidgetRegistry(): WidgetRegistry {
    if (!this.widgetRegistry) this.widgetRegistry = new WidgetRegistry();
    return this.widgetRegistry;
  }

  async shutdown(): Promise<void> {
    this.refreshScheduler?.stopAll();
    await this.sourceRegistry.closeAll();
  }
}

/**
 * Pick a value by dot-path. Supports plain object keys and numeric
 * array indices ('items.0.name'). Returns undefined for missing paths
 * — refresh ticks treat undefined as "no update this turn."
 */
function pickByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Build an object whose dot-path entry equals `value`. Used by HTTP
 * refresh's `into` directive to merge a scalar into a nested payload
 * field (e.g. into='fields.0.value' produces { fields: [{ value: ... }] }).
 */
function setByPath(
  base: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const parts = path.split('.');
  let cursor: Record<string, unknown> | unknown[] = base;
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i]!;
    const isLast = i === parts.length - 1;
    const isArrayIdx = /^\d+$/.test(key);
    if (isLast) {
      if (Array.isArray(cursor)) (cursor as unknown[])[parseInt(key, 10)] = value;
      else (cursor as Record<string, unknown>)[key] = value;
      break;
    }
    const next = parts[i + 1]!;
    const childIsArray = /^\d+$/.test(next);
    let child: Record<string, unknown> | unknown[];
    if (Array.isArray(cursor)) {
      child = (cursor as unknown[])[parseInt(key, 10)] as
        | Record<string, unknown>
        | unknown[];
      if (!child) {
        child = childIsArray ? [] : {};
        (cursor as unknown[])[parseInt(key, 10)] = child;
      }
    } else {
      child = (cursor as Record<string, unknown>)[key] as
        | Record<string, unknown>
        | unknown[];
      if (!child) {
        child = childIsArray ? [] : {};
        (cursor as Record<string, unknown>)[key] = child;
      }
    }
    cursor = child;
    if (isArrayIdx) {
      // current step was an array index; cursor is now an array entry
    }
  }
  return base;
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

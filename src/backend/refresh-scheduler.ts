import type { CanvasEventBus } from './canvas-event-bus.js';

/**
 * Scheduled refresh service for "live" widgets.
 *
 * A widget can declare a refresh policy via meta:
 *   meta.refresh = {
 *     everyMs: number,                          // tick interval
 *     source:  'http' | 'kb' | 'web',           // refresh source
 *     spec:    HttpRefreshSpec | KbRefreshSpec | WebRefreshSpec,
 *     mergePath?: string[],                     // where to merge the new value
 *                                                // into props (defaults to ['payload'])
 *   }
 *
 * The frontend POSTs the registration to /v1/canvas/refresh/register
 * after the shape lands; the scheduler fires the spec on its interval
 * and emits an 'update' directive into the conversation's event bus.
 *
 * This module intentionally has NO dependency on Hono / state — the
 * route layer wires it together. Tests instantiate directly.
 */

export type HttpRefreshSpec = {
  url: string;
  /** Optional JSONPath-ish dot path into the response (e.g. 'data.price'). */
  pick?: string;
  /** Map the picked value into a payload key (e.g. 'fields.0.value'). */
  into?: string;
};
export type KbRefreshSpec = {
  /** Search query. The newest hit's body is merged into payload.body. */
  query: string;
};
export type WebRefreshSpec = {
  query: string;
};

export type RefreshPolicy = {
  everyMs: number;
  source: 'http' | 'kb' | 'web';
  spec: HttpRefreshSpec | KbRefreshSpec | WebRefreshSpec;
  /** Path into shape props the refresh result merges into. Defaults to root. */
  mergePath?: string[];
};

type Registration = {
  conversationId: string;
  widgetId: string;
  policy: RefreshPolicy;
  bus: CanvasEventBus;
  timer: ReturnType<typeof setInterval>;
};

/**
 * Adapter the route layer hands in for HTTP/KB/Web sources. Keeps the
 * scheduler decoupled from BackendState — easier to test, no circular
 * imports.
 */
export type RefreshSources = {
  http: (spec: HttpRefreshSpec) => Promise<unknown>;
  kb: (spec: KbRefreshSpec) => Promise<unknown>;
  web: (spec: WebRefreshSpec) => Promise<unknown>;
};

/** Bound for refresh-rate per widget (1s minimum, 1d maximum). */
const MIN_INTERVAL_MS = 1_000;
const MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class RefreshScheduler {
  private registrations = new Map<string, Registration>();

  constructor(private readonly sources: RefreshSources) {}

  /**
   * Register a refresh policy for a widget. Replaces any existing
   * registration for the same id (so the frontend can reconfigure
   * without manually unregistering first).
   */
  register(args: {
    conversationId: string;
    widgetId: string;
    policy: RefreshPolicy;
    bus: CanvasEventBus;
  }): void {
    this.unregister(args.widgetId);

    const everyMs = clamp(
      args.policy.everyMs,
      MIN_INTERVAL_MS,
      MAX_INTERVAL_MS,
    );
    const policy = { ...args.policy, everyMs };
    const tick = async () => {
      try {
        const result = await this.runSource(policy);
        if (result === undefined) return;
        const merged = buildMergeProps(policy.mergePath, result);
        args.bus.push({
          directive: {
            type: 'update',
            id: args.widgetId,
            payload: merged,
          },
        });
      } catch (e) {
        console.warn(
          `[refresh] tick failed for ${args.widgetId}:`,
          e instanceof Error ? e.message : e,
        );
      }
    };
    const timer = setInterval(tick, everyMs);
    // Fire the first tick immediately so the user sees data without waiting.
    setTimeout(tick, 0);

    this.registrations.set(args.widgetId, {
      conversationId: args.conversationId,
      widgetId: args.widgetId,
      policy,
      bus: args.bus,
      timer,
    });
  }

  /** Stop refreshing a widget. Safe to call with an unknown id. */
  unregister(widgetId: string): boolean {
    const reg = this.registrations.get(widgetId);
    if (!reg) return false;
    clearInterval(reg.timer);
    this.registrations.delete(widgetId);
    return true;
  }

  /** All registrations for a conversation — used for diagnostics. */
  list(conversationId: string): Registration[] {
    return Array.from(this.registrations.values()).filter(
      (r) => r.conversationId === conversationId,
    );
  }

  /** Stop every active refresh. Used at shutdown. */
  stopAll(): void {
    for (const r of this.registrations.values()) clearInterval(r.timer);
    this.registrations.clear();
  }

  private async runSource(policy: RefreshPolicy): Promise<unknown> {
    if (policy.source === 'http') {
      return this.sources.http(policy.spec as HttpRefreshSpec);
    }
    if (policy.source === 'kb') {
      return this.sources.kb(policy.spec as KbRefreshSpec);
    }
    return this.sources.web(policy.spec as WebRefreshSpec);
  }
}

/**
 * Build a partial props patch that, when merged over existing props,
 * places `value` at the given dotted path. Path is an array of keys
 * (strings) and indices (numbers). Empty path → value becomes the
 * patch root (must be an object).
 */
export function buildMergeProps(
  path: ReadonlyArray<string | number> | undefined,
  value: unknown,
): Record<string, unknown> {
  if (!path || path.length === 0) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    // Caller asked for a root merge but supplied a primitive — wrap it
    // under `value` so the dispatcher's update path doesn't crash.
    return { value };
  }
  const out: Record<string, unknown> = {};
  let cursor: Record<string, unknown> | unknown[] = out;
  for (let i = 0; i < path.length; i++) {
    const key = path[i]!;
    const isLast = i === path.length - 1;
    if (isLast) {
      (cursor as Record<string, unknown>)[String(key)] = value;
      break;
    }
    const next = path[i + 1]!;
    const child: Record<string, unknown> | unknown[] =
      typeof next === 'number' ? [] : {};
    (cursor as Record<string, unknown>)[String(key)] = child;
    cursor = child;
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

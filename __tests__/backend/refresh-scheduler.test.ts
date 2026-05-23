import { describe, it, expect, vi } from 'vitest';
import {
  RefreshScheduler,
  buildMergeProps,
} from '../../src/backend/refresh-scheduler.js';
import { CanvasEventBus } from '../../src/backend/canvas-event-bus.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('RefreshScheduler', () => {
  it('emits an update directive on the bus when a tick succeeds', async () => {
    vi.useFakeTimers();
    const bus = new CanvasEventBus();
    const sub = bus.subscribe();
    const got = deferred<{ kind: string; id: string; payload: unknown }>();
    (async () => {
      for await (const e of sub) {
        if (e.directive.type === 'update') {
          got.resolve({
            kind: 'update',
            id: e.directive.id,
            payload: e.directive.payload,
          });
          break;
        }
      }
    })();

    const sources: import('../../src/backend/refresh-scheduler.js').RefreshSources = {
      http: vi.fn(async () => ({ price: 67500 })),
      kb: vi.fn(async () => ({})),
      web: vi.fn(async () => ({})),
    };
    const sched = new RefreshScheduler(sources);
    sched.register({
      conversationId: 'c1',
      widgetId: 'w1',
      bus,
      policy: { everyMs: 5_000, source: 'http', spec: { url: 'x' } },
    });

    await vi.advanceTimersByTimeAsync(0); // immediate first tick
    const r = await got.promise;
    expect(r.id).toBe('w1');
    expect(r.payload).toEqual({ price: 67500 });

    sched.stopAll();
    sub.close();
    vi.useRealTimers();
  });

  it('clamps everyMs to >= 1000ms', async () => {
    vi.useFakeTimers();
    const sources: import('../../src/backend/refresh-scheduler.js').RefreshSources = {
      http: vi.fn(async () => ({})),
      kb: vi.fn(async () => ({})),
      web: vi.fn(async () => ({})),
    };
    const sched = new RefreshScheduler(sources);
    sched.register({
      conversationId: 'c',
      widgetId: 'w',
      bus: new CanvasEventBus(),
      policy: { everyMs: 50, source: 'http', spec: { url: 'x' } },
    });
    // first tick fires immediately (setTimeout 0)
    await vi.advanceTimersByTimeAsync(0);
    expect(sources.http).toHaveBeenCalledTimes(1);
    // next tick at the clamped 1000ms
    await vi.advanceTimersByTimeAsync(999);
    expect(sources.http).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sources.http).toHaveBeenCalledTimes(2);
    sched.stopAll();
    vi.useRealTimers();
  });

  it('unregister stops further ticks', async () => {
    vi.useFakeTimers();
    const sources: import('../../src/backend/refresh-scheduler.js').RefreshSources = {
      http: vi.fn(async () => ({})),
      kb: vi.fn(async () => ({})),
      web: vi.fn(async () => ({})),
    };
    const sched = new RefreshScheduler(sources);
    sched.register({
      conversationId: 'c',
      widgetId: 'w',
      bus: new CanvasEventBus(),
      policy: { everyMs: 1_000, source: 'http', spec: { url: 'x' } },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(sources.http).toHaveBeenCalledTimes(1);
    expect(sched.unregister('w')).toBe(true);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sources.http).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  describe('buildMergeProps', () => {
    it('returns the value as-is when path is empty and value is an object', () => {
      expect(buildMergeProps([], { a: 1 })).toEqual({ a: 1 });
    });
    it('wraps primitives under `value` when path is empty', () => {
      expect(buildMergeProps([], 42)).toEqual({ value: 42 });
    });
    it('builds a nested structure for a key path', () => {
      expect(buildMergeProps(['payload', 'body'], 'hello')).toEqual({
        payload: { body: 'hello' },
      });
    });
    it('uses arrays for numeric path elements', () => {
      expect(buildMergeProps(['items', 0, 'name'], 'a')).toEqual({
        items: [{ name: 'a' }],
      });
    });
  });
});

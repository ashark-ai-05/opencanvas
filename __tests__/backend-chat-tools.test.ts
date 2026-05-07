import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { chatRoute } from '../src/backend/routes/chat.js';
import { makeMockProvider } from './helpers/mock-provider.js';
import type { BackendState } from '../src/backend/state.js';

function makeState(events: Parameters<typeof makeMockProvider>[0]) {
  const provider = makeMockProvider(events);
  let latestSnapshot: unknown = null;
  const sessions = new Map<string, string>();
  // Minimal stub registry — chat route reads it eagerly to surface
  // plugin kinds in the place_widget tool description.
  const stubRegistry = {
    list: () => [],
    has: () => false,
    register: () => {
      throw new Error('not implemented in test stub');
    },
    unregister: () => false,
    get: () => undefined,
    subscribe: () => () => {},
    subscriberCount: () => 0,
  };
  return {
    getLLMProvider: () => provider,
    setLatestSnapshot: (s: unknown) => {
      latestSnapshot = s;
    },
    getLatestSnapshot: () => latestSnapshot,
    getSessionId: (id: string) => sessions.get(id),
    setSessionId: (id: string, sess: string) => sessions.set(id, sess),
    clearSessionId: (id: string) => sessions.delete(id),
    getWidgetRegistry: () => stubRegistry,
    registerStreamWidget: () => {},
    unregisterStreamWidget: () => {},
    cancelStreamWidget: () => false,
    getCanvasEventBus: () => ({
      push: () => {},
      subscribe: () => ({
        close: () => {},
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ value: undefined, done: true }),
        }),
      }),
      subscriberCount: () => 0,
    }),
  } as unknown as BackendState;
}

describe('POST /v1/chat — canvasSnapshot + abortSignal', () => {
  it('threads canvasSnapshot from request body to provider', async () => {
    const state = makeState([{ type: 'done' }]);
    const app = new Hono().route('/', chatRoute(state));

    const snap = {
      activeTemplateId: 'ask-anything',
      widgets: [
        {
          id: 'w-1',
          kind: 'markdown',
          role: 'primary',
          title: 't',
          payload: { title: 't', body: 'b' },
        },
      ],
    };
    const res = await app.request('/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
        canvasSnapshot: snap,
      }),
    });
    expect(res.status).toBe(200);
    // Drain the stream so the for-await in the route completes
    await res.text();

    const provider = state.getLLMProvider() as ReturnType<typeof makeMockProvider>;
    expect(provider.receivedRequests).toHaveLength(1);
    expect(provider.receivedRequests[0]!.canvasSnapshot?.widgets).toHaveLength(1);
  });

  it('defaults to an empty snapshot when canvasSnapshot omitted', async () => {
    const state = makeState([{ type: 'done' }]);
    const app = new Hono().route('/', chatRoute(state));

    const res = await app.request('/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    });
    await res.text();

    const provider = state.getLLMProvider() as ReturnType<typeof makeMockProvider>;
    expect(provider.receivedRequests[0]!.canvasSnapshot).toBeDefined();
    expect(provider.receivedRequests[0]!.canvasSnapshot?.widgets).toHaveLength(0);
  });

  it('passes an abortSignal to the provider', async () => {
    const state = makeState([{ type: 'done' }]);
    const app = new Hono().route('/', chatRoute(state));

    const res = await app.request('/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
      }),
    });
    await res.text();

    const provider = state.getLLMProvider() as ReturnType<typeof makeMockProvider>;
    expect(provider.receivedRequests[0]!.abortSignal).toBeInstanceOf(AbortSignal);
  });
});

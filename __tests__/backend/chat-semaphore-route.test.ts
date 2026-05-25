import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { chatRoute } from '../../src/backend/routes/chat.js';
import { makeMockProvider } from '../helpers/mock-provider.js';
import {
  getProcessChatSemaphore,
  __resetProcessChatSemaphoreForTests,
} from '../../src/backend/chat-semaphore.js';
import type { BackendState } from '../../src/backend/state.js';

function makeState() {
  const provider = makeMockProvider([{ type: 'done' }]);
  let latestSnapshot: unknown = null;
  const sessions = new Map<string, string>();
  const stubRegistry = {
    list: () => [],
    has: () => false,
    register: () => {
      throw new Error('not implemented');
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

const REQUEST_BODY = JSON.stringify({
  messages: [
    { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
  ],
});

describe('POST /v1/chat — concurrency cap', () => {
  beforeEach(() => {
    __resetProcessChatSemaphoreForTests();
    process.env['OPENCANVAS_CHAT_MAX_CONCURRENT'] = '1';
  });
  afterEach(() => {
    __resetProcessChatSemaphoreForTests();
    delete process.env['OPENCANVAS_CHAT_MAX_CONCURRENT'];
  });

  it('returns 503 with structured body when saturated', async () => {
    const sem = getProcessChatSemaphore();
    // Pre-acquire the only slot so the next request must be rejected.
    expect(sem.tryAcquire()).toBe(true);

    const app = new Hono().route('/', chatRoute(makeState()));
    const res = await app.request('/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: REQUEST_BODY,
    });

    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['error']).toBe('demo-at-capacity');
    expect(body['code']).toBe('CHAT_CAPACITY_EXCEEDED');
    expect(typeof body['message']).toBe('string');
    expect((body['message'] as string).toLowerCase()).toContain('capacity');
    expect(body['inFlight']).toBe(1);
    expect(body['capacity']).toBe(1);
  });

  it('releases the slot after a successful turn completes', async () => {
    const sem = getProcessChatSemaphore();
    expect(sem.inFlight()).toBe(0);

    const app = new Hono().route('/', chatRoute(makeState()));
    const res = await app.request('/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: REQUEST_BODY,
    });
    expect(res.status).toBe(200);

    // Drain the SSE body so the stream callback's finally runs.
    await res.text();

    expect(sem.inFlight()).toBe(0);
  });

  it('after release, a new request acquires successfully', async () => {
    const sem = getProcessChatSemaphore();
    sem.tryAcquire();

    const app = new Hono().route('/', chatRoute(makeState()));

    // First request — blocked.
    const blocked = await app.request('/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: REQUEST_BODY,
    });
    expect(blocked.status).toBe(503);

    // Release the manually-held slot.
    sem.release();
    expect(sem.inFlight()).toBe(0);

    // Second request — should pass through to the streaming handler.
    const ok = await app.request('/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: REQUEST_BODY,
    });
    expect(ok.status).toBe(200);
    await ok.text();
    expect(sem.inFlight()).toBe(0);
  });
});

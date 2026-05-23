import { describe, it, expect, beforeEach } from 'vitest';
import { BackendState } from '../src/backend/state.js';
import { canvasRoute } from '../src/backend/routes/canvas.js';
import type { ToolDirective } from '../src/agent/types.js';

/**
 * Each route test:
 *  - subscribes to the per-conversation bus directly (no SSE round-trip)
 *  - calls the route via fetch on the sub-app
 *  - asserts the directive that landed on the bus
 *
 * Routes that depend on conversation routing all check the
 * `conversationId required when no active id is set` path too.
 */
async function setup() {
  const state = await BackendState.create();
  const route = canvasRoute(state);
  return { state, route };
}

async function nextEvent(
  bus: { subscribe: () => AsyncIterable<{ directive: ToolDirective }> },
  timeoutMs = 100,
): Promise<ToolDirective | null> {
  const sub = bus.subscribe();
  const it = (sub as AsyncIterable<{ directive: ToolDirective }>)[
    Symbol.asyncIterator
  ]();
  return await Promise.race([
    it.next().then((r) => (r.done ? null : r.value.directive)),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

const CONV = 'test-conv-1';

describe('/v1/canvas/* routes', () => {
  let state: BackendState;
  let route: ReturnType<typeof canvasRoute>;

  beforeEach(async () => {
    ({ state, route } = await setup());
  });

  describe('POST /v1/canvas/active-conversation', () => {
    it('updates active conversation id', async () => {
      const res = await route.request('/v1/canvas/active-conversation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId: CONV }),
      });
      expect(res.status).toBe(200);
      expect(state.getActiveConversationId()).toBe(CONV);
    });
  });

  describe('POST /v1/canvas/widgets', () => {
    it('places a valid markdown widget and emits a place directive', async () => {
      const bus = state.getCanvasEventBus(CONV);
      const eventP = nextEvent(bus);
      const res = await route.request('/v1/canvas/widgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'markdown',
          role: 'primary',
          payload: { title: 'Hello', body: 'World' },
          conversationId: CONV,
        }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        ok: boolean;
        id: string;
        directive: ToolDirective;
      };
      expect(json.ok).toBe(true);
      expect(json.directive.type).toBe('place');
      const event = await eventP;
      expect(event?.type).toBe('place');
    });

    it('falls back to generic on a malformed specialized payload', async () => {
      const res = await route.request('/v1/canvas/widgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'web-embed',
          role: 'primary',
          payload: { title: 'no-url' }, // missing required url
          conversationId: CONV,
        }),
      });
      const json = (await res.json()) as {
        directive: ToolDirective & { kind: string };
        reformatted: { from: string };
      };
      expect(json.directive.kind).toBe('generic');
      expect(json.reformatted.from).toBe('web-embed');
    });

    it('reformats unknown kinds via the auto-classifier', async () => {
      const res = await route.request('/v1/canvas/widgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'candlestick-chart',
          role: 'primary',
          payload: { title: 'BTC', columns: [{ key: 't' }], rows: [['09:00']] },
          conversationId: CONV,
        }),
      });
      const json = (await res.json()) as {
        directive: ToolDirective & { kind: string };
        reformatted: { from: string };
      };
      expect(json.directive.kind).toBe('generic');
      expect(json.reformatted.from).toBe('candlestick-chart');
    });

    it('rejects when no conversation id is set anywhere', async () => {
      const res = await route.request('/v1/canvas/widgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'markdown',
          role: 'primary',
          payload: { title: 't', body: 'b' },
        }),
      });
      expect(res.status).toBe(404);
    });

    it('falls back to active conversation when id omitted', async () => {
      state.setActiveConversationId(CONV);
      const res = await route.request('/v1/canvas/widgets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'markdown',
          role: 'primary',
          payload: { title: 't', body: 'b' },
        }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('PATCH /v1/canvas/widgets/:id', () => {
    it('emits an update directive', async () => {
      const bus = state.getCanvasEventBus(CONV);
      const eventP = nextEvent(bus);
      const res = await route.request('/v1/canvas/widgets/w1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payload: { title: 'updated' },
          conversationId: CONV,
        }),
      });
      expect(res.status).toBe(200);
      const event = await eventP;
      expect(event?.type).toBe('update');
    });

    it('rejects when both payload and appendSections are present', async () => {
      const res = await route.request('/v1/canvas/widgets/w1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          payload: {},
          appendSections: [],
          conversationId: CONV,
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /v1/canvas/widgets/:id', () => {
    it('emits a remove directive', async () => {
      const bus = state.getCanvasEventBus(CONV);
      const eventP = nextEvent(bus);
      state.setActiveConversationId(CONV);
      const res = await route.request('/v1/canvas/widgets/w1', {
        method: 'DELETE',
      });
      expect(res.status).toBe(200);
      const event = await eventP;
      expect(event?.type).toBe('remove');
      if (event?.type === 'remove') expect(event.id).toBe('w1');
    });
  });

  describe('POST /v1/canvas/widgets/:id/focus', () => {
    it('emits a focus directive', async () => {
      const bus = state.getCanvasEventBus(CONV);
      const eventP = nextEvent(bus);
      state.setActiveConversationId(CONV);
      const res = await route.request('/v1/canvas/widgets/w1/focus', {
        method: 'POST',
      });
      expect(res.status).toBe(200);
      const event = await eventP;
      expect(event?.type).toBe('focus');
    });
  });

  describe('POST /v1/canvas/clear', () => {
    it('emits a clear directive', async () => {
      const bus = state.getCanvasEventBus(CONV);
      const eventP = nextEvent(bus);
      state.setActiveConversationId(CONV);
      const res = await route.request('/v1/canvas/clear', { method: 'POST' });
      expect(res.status).toBe(200);
      const event = await eventP;
      expect(event?.type).toBe('clear');
    });
  });

  describe('POST /v1/canvas/links', () => {
    it('emits a link directive with a generated linkId', async () => {
      const bus = state.getCanvasEventBus(CONV);
      const eventP = nextEvent(bus);
      const res = await route.request('/v1/canvas/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fromId: 'a',
          toId: 'b',
          label: 'depends on',
          conversationId: CONV,
        }),
      });
      const json = (await res.json()) as { linkId: string };
      expect(json.linkId).toBeDefined();
      const event = await eventP;
      expect(event?.type).toBe('link');
      if (event?.type === 'link') {
        expect(event.fromId).toBe('a');
        expect(event.toId).toBe('b');
      }
    });
  });

  describe('POST /v1/canvas/template', () => {
    it('emits a switchTemplate directive', async () => {
      const bus = state.getCanvasEventBus(CONV);
      const eventP = nextEvent(bus);
      const res = await route.request('/v1/canvas/template', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'tell-me-about-x',
          conversationId: CONV,
        }),
      });
      expect(res.status).toBe(200);
      const event = await eventP;
      expect(event?.type).toBe('switchTemplate');
    });

    it('rejects unknown template ids', async () => {
      const res = await route.request('/v1/canvas/template', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'made-up',
          conversationId: CONV,
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('streaming', () => {
    it('opens a stream, applies ops, and closes', async () => {
      const bus = state.getCanvasEventBus(CONV);
      // Subscribe ONCE at the very start so events queue for ordered drain.
      const sub = bus.subscribe();
      const it = (sub as AsyncIterable<{ directive: ToolDirective }>)[
        Symbol.asyncIterator
      ]();

      const startRes = await route.request('/v1/canvas/streams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'generic',
          role: 'primary',
          scaffold: { title: 'streaming', blocks: [{ type: 'markdown', content: '' }] },
          conversationId: CONV,
        }),
      });
      const startJson = (await startRes.json()) as { id: string };
      const id = startJson.id;

      await route.request(`/v1/canvas/streams/${id}/ops`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ops: [
            { kind: 'append-text', blockIndex: 0, text: 'hello ' },
            { kind: 'append-text', blockIndex: 0, text: 'world' },
          ],
          conversationId: CONV,
        }),
      });

      await route.request(`/v1/canvas/streams/${id}/end`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, conversationId: CONV }),
      });

      const start = (await it.next()).value!.directive;
      const op1 = (await it.next()).value!.directive;
      const op2 = (await it.next()).value!.directive;
      const end = (await it.next()).value!.directive;
      expect(start.type).toBe('stream-start');
      expect(op1.type).toBe('stream-op');
      if (op1.type === 'stream-op') expect(op1.seq).toBe(1);
      expect(op2.type).toBe('stream-op');
      if (op2.type === 'stream-op') expect(op2.seq).toBe(2);
      expect(end.type).toBe('stream-end');

      sub.close();
    });

    it('cancel emits stream-end with ok=false', async () => {
      const bus = state.getCanvasEventBus(CONV);
      state.setActiveConversationId(CONV);
      const sub = bus.subscribe();
      const it = (sub as AsyncIterable<{ directive: ToolDirective }>)[
        Symbol.asyncIterator
      ]();
      await route.request(`/v1/canvas/streams/abc/cancel`, { method: 'POST' });
      const r = (await it.next()).value!.directive;
      expect(r.type).toBe('stream-end');
      if (r.type === 'stream-end') {
        expect(r.ok).toBe(false);
        expect(r.error).toBe('cancelled');
      }
      sub.close();
    });
  });

  describe('auth', () => {
    it('401s when OPENCANVAS_API_KEY is set and Authorization is missing', async () => {
      const prev = process.env['OPENCANVAS_API_KEY'];
      process.env['OPENCANVAS_API_KEY'] = 'secret-token';
      try {
        const res = await route.request('/v1/canvas/clear', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ conversationId: CONV }),
        });
        expect(res.status).toBe(401);
      } finally {
        if (prev === undefined) delete process.env['OPENCANVAS_API_KEY'];
        else process.env['OPENCANVAS_API_KEY'] = prev;
      }
    });

    it('passes when bearer token matches', async () => {
      const prev = process.env['OPENCANVAS_API_KEY'];
      process.env['OPENCANVAS_API_KEY'] = 'secret-token';
      try {
        const res = await route.request('/v1/canvas/clear', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer secret-token',
          },
          body: JSON.stringify({ conversationId: CONV }),
        });
        expect(res.status).toBe(200);
      } finally {
        if (prev === undefined) delete process.env['OPENCANVAS_API_KEY'];
        else process.env['OPENCANVAS_API_KEY'] = prev;
      }
    });
  });
});

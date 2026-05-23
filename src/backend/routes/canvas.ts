import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validatePayloadForKind,
  CompositePayload,
} from '../../agent/payloads.js';
import { classifyToGeneric } from '../../agent/classifier.js';
import { extractText } from '../../indexer/extractors.js';
import {
  WIDGET_KINDS,
  ROLES,
  TEMPLATE_IDS,
  type ToolDirective,
  type WidgetKind,
  type Role,
  type TemplateId,
  type WidgetStreamOp,
} from '../../agent/types.js';
import type { BackendState } from '../state.js';

/**
 * /v1/canvas/* — external HTTP surface so any process can render
 * widgets on a running OpenCanvas instance.
 *
 * Architecture:
 *   external POST → builds a ToolDirective → state.getCanvasEventBus(convId).push
 *               ↘ SSE handler at GET /v1/canvas/events drains the bus
 *               ↘ each subscribed browser tab applies the directive to tldraw
 *
 * Conversation routing:
 *   - Each operation accepts an optional conversationId (body or query).
 *   - Falls back to state.getActiveConversationId() (the browser tells the
 *     backend on every conversation switch via POST active-conversation).
 *   - 404 if no conversation is active and none is supplied.
 *
 * Auth:
 *   - When OPENCANVAS_API_KEY is set, every /v1/canvas/* request must
 *     include `Authorization: Bearer <key>`. Unset → no auth (dev mode).
 *   - The bearer middleware is wired here; it's a no-op when the env
 *     var is missing so existing local workflows aren't disturbed.
 *
 * What this DOES NOT do (yet):
 *   - Per-conversation snapshots: snapshot endpoint returns the latest
 *     snapshot the chat route saw, not per-conversation history.
 *   - Server-Sent Events resync: subscribers that disconnect mid-stream
 *     skip events that landed during the gap.
 *   - Rate limiting: localhost dev default; add a token-bucket if this
 *     gets exposed beyond a single user.
 */
export function canvasRoute(state: BackendState): Hono {
  const r = new Hono();

  // ────────────────────────────────────────────────────────────────
  // Auth gate (no-op when env var is unset).
  // ────────────────────────────────────────────────────────────────
  r.use('/v1/canvas/*', async (c, next) => {
    const required = process.env['OPENCANVAS_API_KEY'];
    if (!required) return next();
    const auth = c.req.header('authorization') ?? '';
    if (auth !== `Bearer ${required}`) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return next();
  });

  // ────────────────────────────────────────────────────────────────
  // SSE — long-lived stream from backend to browser.
  // ────────────────────────────────────────────────────────────────
  r.get('/v1/canvas/events', async (c) => {
    const conversationId = c.req.query('conversationId');
    if (!conversationId) {
      return c.json({ error: 'conversationId query param required' }, 400);
    }

    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');

    return stream(c, async (s) => {
      const bus = state.getCanvasEventBus(conversationId);
      const sub = bus.subscribe();

      // Mirror the request abort signal into the subscription so
      // closing the tab releases the bus listener.
      c.req.raw.signal.addEventListener(
        'abort',
        () => sub.close(),
        { once: true },
      );

      // Initial hello so EventSource fires onopen immediately even
      // when no events have queued yet.
      await s.write(`: connected\n\n`);

      // Subscribe to registry changes so browser plugin cache stays
      // in sync without polling. Plugin events ride the SAME SSE
      // channel as directives (different `event:` line) — easier than
      // a second connection.
      const registry = state.getWidgetRegistry();
      const unsubRegistry = registry.subscribe((event) => {
        const data = JSON.stringify(event);
        // Fire-and-forget; if the writer is closed the catch swallows.
        s.write(`event: widget-kind\ndata: ${data}\n\n`).catch(() => {});
      });
      // Snapshot the current kinds on connect so a freshly-loaded
      // browser tab can populate its cache without a separate GET.
      for (const descriptor of registry.list()) {
        await s.write(
          `event: widget-kind\ndata: ${JSON.stringify({ type: 'register', descriptor })}\n\n`,
        );
      }

      try {
        for await (const event of sub) {
          await s.write(
            `event: directive\ndata: ${JSON.stringify(event.directive)}\n\n`,
          );
        }
      } finally {
        unsubRegistry();
        sub.close();
      }
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Active-conversation handshake — the browser tells the backend
  // which conversation it's currently viewing, so external POSTs
  // without an explicit conversationId can route correctly.
  // ────────────────────────────────────────────────────────────────
  r.post('/v1/canvas/active-conversation', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      conversationId?: string | null;
    };
    state.setActiveConversationId(body.conversationId ?? null);
    return c.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────
  // POST /widgets — place a widget. Mirrors the agent's place_widget,
  // including the auto-classifier fallback for unknown / malformed
  // payloads.
  // ────────────────────────────────────────────────────────────────
  r.post('/v1/canvas/widgets', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      kind?: string;
      role?: string;
      payload?: Record<string, unknown>;
      conversationId?: string;
    };
    const convId = resolveConvId(state, body.conversationId);
    if (!convId) return c.json({ error: 'no active conversation' }, 404);
    if (!body.kind || !body.role || !body.payload) {
      return c.json(
        { error: 'kind, role, payload required' },
        400,
      );
    }
    if (!isRole(body.role)) {
      return c.json({ error: `invalid role: ${body.role}` }, 400);
    }

    const id = randomUUID();
    const kindStr = body.kind;
    const knownKind: WidgetKind | null = isWidgetKind(kindStr) ? kindStr : null;

    // Specialized kind: try the strict schema; on failure, fall back
    // to the auto-classifier exactly like place_widget does.
    if (knownKind) {
      try {
        const validated = validatePayloadForKind(knownKind, body.payload);
        const directive: ToolDirective = {
          type: 'place',
          id,
          kind: knownKind,
          role: body.role,
          payload: validated,
        };
        push(state, convId, directive);
        return c.json({ ok: true, id, directive });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const generic = classifyToGeneric(knownKind, body.payload);
        const directive: ToolDirective = {
          type: 'place',
          id,
          kind: 'generic',
          role: body.role,
          payload: generic as unknown as Record<string, unknown>,
        };
        push(state, convId, directive);
        return c.json({
          ok: true,
          id,
          directive,
          reformatted: { from: knownKind, reason: message },
        });
      }
    }

    // Unknown built-in kind — first try the plugin registry. If a
    // plugin claims this kind, wrap as a 'plugin' directive so the
    // browser's PluginShape dispatches via the registered renderer.
    if (state.getWidgetRegistry().has(kindStr)) {
      const directive: ToolDirective = {
        type: 'place',
        id,
        kind: 'plugin',
        role: body.role,
        payload: {
          pluginKind: kindStr,
          props: body.payload,
          ...(typeof body.payload['title'] === 'string'
            ? { title: body.payload['title'] }
            : {}),
        },
      };
      push(state, convId, directive);
      return c.json({ ok: true, id, directive });
    }

    // Truly unknown — auto-classifier fallback to generic.
    const generic = classifyToGeneric(kindStr, body.payload);
    const directive: ToolDirective = {
      type: 'place',
      id,
      kind: 'generic',
      role: body.role,
      payload: generic as unknown as Record<string, unknown>,
    };
    push(state, convId, directive);
    return c.json({
      ok: true,
      id,
      directive,
      reformatted: { from: kindStr, reason: 'unknown kind' },
    });
  });

  // ────────────────────────────────────────────────────────────────
  // PATCH /widgets/:id — update payload OR append composite sections.
  // ────────────────────────────────────────────────────────────────
  r.patch('/v1/canvas/widgets/:id', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      payload?: Record<string, unknown>;
      appendSections?: Array<{
        heading?: string;
        kind: string;
        payload: Record<string, unknown>;
      }>;
      conversationId?: string;
    };
    const convId = resolveConvId(state, body.conversationId);
    if (!convId) return c.json({ error: 'no active conversation' }, 404);
    if (!body.payload && !body.appendSections) {
      return c.json(
        { error: 'payload or appendSections required' },
        400,
      );
    }
    if (body.payload && body.appendSections) {
      return c.json(
        { error: 'payload and appendSections are mutually exclusive' },
        400,
      );
    }

    if (body.appendSections) {
      // Validate the synthetic composite to catch bad section payloads
      // before we push a directive that would fail in the dispatcher.
      try {
        CompositePayload.parse({
          title: 'append-validation',
          sections: body.appendSections,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return c.json({ error: `invalid appendSections: ${message}` }, 400);
      }
      const directive: ToolDirective = {
        type: 'update',
        id,
        appendSections: body.appendSections as ToolDirective extends {
          appendSections?: infer A;
        }
          ? A
          : never,
      };
      push(state, convId, directive);
      return c.json({ ok: true, directive });
    }

    // Payload replacement: we don't know the widget's stored kind here
    // (the backend doesn't track per-widget kinds for external streams),
    // so we forward the payload verbatim. The dispatcher merges over
    // existing props at the canvas; tldraw rejects shape-prop mismatches.
    const directive: ToolDirective = {
      type: 'update',
      id,
      payload: body.payload!,
    };
    push(state, convId, directive);
    return c.json({ ok: true, directive });
  });

  // ────────────────────────────────────────────────────────────────
  // POST /widgets/:id/focus — zoom to + select a widget.
  // ────────────────────────────────────────────────────────────────
  r.post('/v1/canvas/widgets/:id/focus', async (c) => {
    const id = c.req.param('id');
    const convId = await resolveConvIdFromBody(state, c);
    if (!convId) return c.json({ error: 'no active conversation' }, 404);
    push(state, convId, { type: 'focus', id });
    return c.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────
  // DELETE /widgets/:id — remove one widget.
  // ────────────────────────────────────────────────────────────────
  r.delete('/v1/canvas/widgets/:id', async (c) => {
    const id = c.req.param('id');
    const convId = await resolveConvIdFromBody(state, c);
    if (!convId) return c.json({ error: 'no active conversation' }, 404);
    push(state, convId, { type: 'remove', id });
    return c.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────
  // POST /clear — remove all opencanvas:* widgets.
  // ────────────────────────────────────────────────────────────────
  r.post('/v1/canvas/clear', async (c) => {
    const convId = await resolveConvIdFromBody(state, c);
    if (!convId) return c.json({ error: 'no active conversation' }, 404);
    push(state, convId, { type: 'clear' });
    return c.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────
  // POST /links — connect two widgets with a labeled arrow.
  // ────────────────────────────────────────────────────────────────
  r.post('/v1/canvas/links', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      fromId?: string;
      toId?: string;
      label?: string;
      conversationId?: string;
    };
    const convId = resolveConvId(state, body.conversationId);
    if (!convId) return c.json({ error: 'no active conversation' }, 404);
    if (!body.fromId || !body.toId) {
      return c.json({ error: 'fromId and toId required' }, 400);
    }
    const linkId = randomUUID();
    const directive: ToolDirective = {
      type: 'link',
      linkId,
      fromId: body.fromId,
      toId: body.toId,
      ...(body.label ? { label: body.label } : {}),
    };
    push(state, convId, directive);
    return c.json({ ok: true, linkId, directive });
  });

  // ────────────────────────────────────────────────────────────────
  // POST /template — switch the active canvas template.
  // ────────────────────────────────────────────────────────────────
  r.post('/v1/canvas/template', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      id?: string;
      conversationId?: string;
    };
    const convId = resolveConvId(state, body.conversationId);
    if (!convId) return c.json({ error: 'no active conversation' }, 404);
    if (!body.id || !isTemplateId(body.id)) {
      return c.json({ error: `invalid template id: ${body.id}` }, 400);
    }
    push(state, convId, { type: 'switchTemplate', id: body.id });
    return c.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────
  // GET /snapshot — read canvas state. V1 returns the latest snapshot
  // the chat route mirrored, regardless of conversationId.
  // ────────────────────────────────────────────────────────────────
  r.get('/v1/canvas/snapshot', async (c) => {
    const snap = state.getLatestSnapshot();
    return c.json(snap ?? { activeTemplateId: 'ask-anything', widgets: [] });
  });

  // ────────────────────────────────────────────────────────────────
  // Streaming widgets — same protocol as agent stream_widget but
  // driven from outside. Each POST /streams creates a new id and
  // emits stream-start; ops follow via POST /streams/:id/ops; close
  // with /streams/:id/end.
  // ────────────────────────────────────────────────────────────────
  r.post('/v1/canvas/streams', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      kind?: string;
      role?: string;
      scaffold?: Record<string, unknown>;
      conversationId?: string;
    };
    const convId = resolveConvId(state, body.conversationId);
    if (!convId) return c.json({ error: 'no active conversation' }, 404);
    if (!body.kind || !isWidgetKind(body.kind)) {
      return c.json({ error: `invalid kind: ${body.kind}` }, 400);
    }
    if (!body.role || !isRole(body.role)) {
      return c.json({ error: `invalid role: ${body.role}` }, 400);
    }

    const id = randomUUID();
    const directive: ToolDirective = {
      type: 'stream-start',
      id,
      kind: body.kind,
      role: body.role,
      scaffold: body.scaffold ?? { title: 'Streaming', blocks: [] },
    };
    push(state, convId, directive);
    return c.json({ ok: true, id });
  });

  r.post('/v1/canvas/streams/:id/ops', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      ops?: WidgetStreamOp[];
      conversationId?: string;
    };
    const convId = resolveConvId(state, body.conversationId);
    if (!convId) return c.json({ error: 'no active conversation' }, 404);
    if (!Array.isArray(body.ops) || body.ops.length === 0) {
      return c.json({ error: 'ops array required' }, 400);
    }
    for (const op of body.ops) {
      const seq = state.nextExternalStreamSeq(id);
      push(state, convId, { type: 'stream-op', id, seq, op });
    }
    return c.json({ ok: true, applied: body.ops.length });
  });

  r.post('/v1/canvas/streams/:id/end', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      conversationId?: string;
    };
    const convId = resolveConvId(state, body.conversationId);
    if (!convId) return c.json({ error: 'no active conversation' }, 404);
    const directive: ToolDirective = {
      type: 'stream-end',
      id,
      ok: body.ok ?? true,
      ...(body.error ? { error: body.error } : {}),
    };
    push(state, convId, directive);
    state.endExternalStream(id);
    return c.json({ ok: true });
  });

  r.post('/v1/canvas/streams/:id/cancel', async (c) => {
    const id = c.req.param('id');
    const convId = await resolveConvIdFromBody(state, c);
    if (!convId) return c.json({ error: 'no active conversation' }, 404);
    push(state, convId, {
      type: 'stream-end',
      id,
      ok: false,
      error: 'cancelled',
    });
    state.endExternalStream(id);
    return c.json({ ok: true });
  });

  // ────────────────────────────────────────────────────────────────
  // /widget-kinds — plugin registry. External processes register
  // custom widget kinds; the browser PluginShape renders via the
  // descriptor's renderer.iframe.srcdoc with a postMessage prop bridge.
  // ────────────────────────────────────────────────────────────────
  r.post('/v1/canvas/widget-kinds', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      kind?: string;
      label?: string;
      description?: string;
      renderer?: { type?: string; srcdoc?: string; sandbox?: string;
        defaultSize?: { w?: number; h?: number } };
    };
    if (!body.kind || typeof body.kind !== 'string') {
      return c.json({ error: 'kind required' }, 400);
    }
    if ((WIDGET_KINDS as readonly string[]).includes(body.kind)) {
      return c.json({ error: `cannot override built-in kind: ${body.kind}` }, 400);
    }
    if (
      !body.renderer ||
      body.renderer.type !== 'iframe' ||
      typeof body.renderer.srcdoc !== 'string'
    ) {
      return c.json({ error: 'renderer.{type:"iframe", srcdoc} required' }, 400);
    }
    const stored = state.getWidgetRegistry().register({
      kind: body.kind,
      ...(body.label ? { label: body.label } : {}),
      ...(body.description ? { description: body.description } : {}),
      renderer: {
        type: 'iframe',
        srcdoc: body.renderer.srcdoc,
        sandbox: body.renderer.sandbox,
        defaultSize:
          body.renderer.defaultSize?.w && body.renderer.defaultSize.h
            ? { w: body.renderer.defaultSize.w, h: body.renderer.defaultSize.h }
            : undefined,
      },
    });
    return c.json({ ok: true, descriptor: stored });
  });

  r.delete('/v1/canvas/widget-kinds/:kind', async (c) => {
    const removed = state.getWidgetRegistry().unregister(c.req.param('kind'));
    return c.json({ ok: removed });
  });

  r.get('/v1/canvas/widget-kinds', async (c) => {
    const kinds = state.getWidgetRegistry().list();
    return c.json({ kinds });
  });

  // ────────────────────────────────────────────────────────────────
  // POST /upload — accept a single file, extract text, return it.
  // The browser then fires a chat turn with the text framed for the
  // agent ("summarise this into widgets"). Cap is intentionally
  // generous (~250kB chars) — beyond that we ask the user to chunk
  // by hand or use the indexer pipeline.
  // ────────────────────────────────────────────────────────────────
  r.post('/v1/canvas/upload', async (c) => {
    const form = await c.req.parseBody().catch(() => null);
    if (!form) return c.json({ error: 'expected multipart/form-data' }, 400);
    const file = form['file'];
    if (!(file instanceof File)) {
      return c.json({ error: 'missing `file` part' }, 400);
    }

    // Persist to a tmp file because most extractors are path-based
    // (pdf-parse, mammoth, xlsx). Cleanup in finally so failures
    // don't leak.
    const dir = await mkdtemp(join(tmpdir(), 'opencanvas-upload-'));
    const ext = extname(file.name) || '.txt';
    const path = join(dir, `upload${ext}`);
    let text: string | null = null;
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      await writeFile(path, buf);
      text = await extractText(path);
    } finally {
      await unlink(path).catch(() => {});
    }

    if (!text) {
      return c.json(
        {
          error: `no extractor for ${ext} (supported: .md, .txt, .pdf, .docx, .xlsx, .json, .yaml)`,
        },
        415,
      );
    }

    // Hard cap so a giant PDF doesn't blow the LLM context.
    const MAX = 250_000;
    const truncated = text.length > MAX;
    const body = truncated ? text.slice(0, MAX) : text;
    return c.json({
      ok: true,
      filename: file.name,
      bytes: file.size,
      chars: text.length,
      truncated,
      text: body,
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Live refresh — register a recurring refetch policy for a widget.
  // Frontend POSTs after a place_widget when meta.refresh is set, OR
  // an external app declares a live data widget directly.
  // ────────────────────────────────────────────────────────────────
  r.post('/v1/canvas/refresh/register', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      widgetId?: string;
      conversationId?: string;
      policy?: {
        everyMs: number;
        source: 'http' | 'kb' | 'web';
        spec: Record<string, unknown>;
        mergePath?: Array<string | number>;
      };
    };
    const convId = resolveConvId(state, body.conversationId);
    if (!convId) return c.json({ error: 'no active conversation' }, 404);
    if (!body.widgetId || !body.policy) {
      return c.json({ error: 'widgetId and policy required' }, 400);
    }
    const scheduler = state.getRefreshScheduler();
    scheduler.register({
      conversationId: convId,
      widgetId: body.widgetId,
      policy: body.policy as Parameters<typeof scheduler.register>[0]['policy'],
      bus: state.getCanvasEventBus(convId),
    });
    return c.json({ ok: true });
  });

  r.post('/v1/canvas/refresh/unregister', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      widgetId?: string;
    };
    if (!body.widgetId) return c.json({ error: 'widgetId required' }, 400);
    const removed = state.getRefreshScheduler().unregister(body.widgetId);
    return c.json({ ok: removed });
  });

  return r;
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────
function push(
  state: BackendState,
  conversationId: string,
  directive: ToolDirective,
): void {
  state.getCanvasEventBus(conversationId).push({ directive });
}

function resolveConvId(
  state: BackendState,
  fromBody: string | undefined,
): string | null {
  if (fromBody && fromBody.length > 0) return fromBody;
  return state.getActiveConversationId();
}

async function resolveConvIdFromBody(
  state: BackendState,
  c: { req: { json: () => Promise<unknown>; query: (k: string) => string | undefined } },
): Promise<string | null> {
  const fromQuery = c.req.query('conversationId');
  if (fromQuery) return fromQuery;
  const body = (await c.req.json().catch(() => ({}))) as {
    conversationId?: string;
  };
  return resolveConvId(state, body.conversationId);
}

function isWidgetKind(s: string): s is WidgetKind {
  return (WIDGET_KINDS as readonly string[]).includes(s);
}
function isRole(s: string): s is Role {
  return (ROLES as readonly string[]).includes(s);
}
function isTemplateId(s: string): s is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(s);
}

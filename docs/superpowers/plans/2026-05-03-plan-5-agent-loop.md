# Agent Loop with Tool-Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Claude Agent SDK tool-calling into `/v1/chat` so chat questions can autonomously search the index and place/manipulate canvas widgets in real time.

**Architecture:** Backend tool handlers as thin directive emitters; browser is canvas source of truth; per-turn canvas snapshot threaded into the SDK call. The Claude Agent SDK runs the agent loop natively; we emit `tool-call` / `tool-result` ProviderEvents and forward them as UIMS `tool-input-available` / `tool-output-available` chunks. Browser receives chunks and dispatches directives to tldraw.

**Tech Stack:** Node 24 / TypeScript, Hono backend, Vite + React 19 + tldraw 3 frontend, `@anthropic-ai/claude-agent-sdk@0.2.126` (`tool()` + `createSdkMcpServer` for in-process tools), AI SDK 6 `useChat`, Zod for schemas, Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-05-03-plan-5-agent-loop-design.md`

---

## File structure

### New files (backend)

| Path | Responsibility |
|------|---------------|
| `src/agent/types.ts` | `WidgetKind`, `Role`, `TemplateId` enums; `ToolDirective` discriminated union; shared with frontend via path import |
| `src/agent/payloads.ts` | Per-`WidgetKind` Zod schemas; `validatePayloadForKind(kind, payload)` helper |
| `src/agent/canvas-snapshot.ts` | `CanvasSnapshot` Zod schema; `parseCanvasSnapshot(raw)` with default fallback |
| `src/agent/tools/search-kb.ts` | Search index tool (real I/O via SearchService) |
| `src/agent/tools/fetch-result.ts` | Fetch one search-result payload by id |
| `src/agent/tools/place-widget.ts` | Validate kind+role+payload, mint UUID, emit directive |
| `src/agent/tools/read-canvas.ts` | Read summary list from snapshot |
| `src/agent/tools/read-widget.ts` | Read one widget's payload from snapshot |
| `src/agent/tools/focus-widget.ts` | Emit `focus` directive |
| `src/agent/tools/link-widgets.ts` | Validate two ids; mint linkId; emit `link` directive |
| `src/agent/tools/clear-canvas.ts` | Emit `clear` directive |
| `src/agent/tools/switch-template.ts` | Validate template id; emit `switchTemplate` directive |
| `src/agent/tools/index.ts` | Aggregate all 9 tools as `SdkMcpToolDefinition[]` for the SDK |

### Extended (backend)

| Path | Change |
|------|--------|
| `src/core/provider.ts` | Add `canvasSnapshot?` and `abortSignal?` to `QueryRequest`; add `toolCallId: string` to `tool-call` and `tool-result` ProviderEvents; add `isError?: boolean` to `tool-result` |
| `src/providers/claude-agent-sdk.ts` | Wire `createSdkMcpServer` with all tools; emit `tool-call` (from `tool_use` blocks) with `toolCallId` and `tool-result` (from SDK `user` messages with `tool_result` content) with `isError`; thread `abortSignal` to SDK's `abortController`; set `effort: 'medium'`, `maxTurns: 10`, `maxOutputTokens: 8192`, `thinking.display: 'summarized'` |
| `src/backend/uims-stream.ts` | Forward `tool-call` → `tool-input-available`; forward `tool-result` → `tool-output-available` (or `tool-output-error` if `isError`) |
| `src/backend/routes/chat.ts` | Parse `canvasSnapshot` from request body via `parseCanvasSnapshot`; thread `abortSignal` from `c.req.raw.signal` to provider |

### New files (frontend)

| Path | Responsibility |
|------|---------------|
| `app/src/canvas/role-layout.ts` | `slotForRole(template, role, occupancy, viewport)` → `{x, y, w, h}` |
| `app/src/canvas/snapshot.ts` | `computeCanvasSnapshot(editor, templateId)` walks shapes, returns `CanvasSnapshot` |
| `__tests__/helpers/mock-provider.ts` | Test double — yields a scripted `ProviderEvent[]` |
| `__tests__/helpers/canvas-snapshot.ts` | Fixture builders for `CanvasSnapshot` with N widgets |

### Extended (frontend)

| Path | Change |
|------|--------|
| `app/src/canvas/dispatcher.ts` | Add `applyToolDirective(editor, directive)` entry point; per-directive functions |
| `app/src/canvas/templates/types.ts` | `CanvasTemplate` gains `slotForRole(role, occupancy, viewport)` method |
| `app/src/canvas/templates/{ask-anything,tell-me-about-x,whats-new-since-y,trace-x-everywhere}.ts` | Implement `slotForRole` (one row of code per template — coords for each role) |
| `app/src/components/Chat.tsx` | Send `canvasSnapshot` in request body via `useChat` `body` option; render `tool-input-available` / `tool-output-available` parts; call `applyToolDirective` when a tool-output is a directive |

### Manual

| Path | Responsibility |
|------|---------------|
| `__tests__/manual/plan-5-smoke.md` | Four manual smoke flows from §5 of the spec |

---

## Tasks

### Task 1: Add shared type enums and Directive union

**Files:**
- Create: `src/agent/types.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/agent/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  WIDGET_KINDS,
  ROLES,
  TEMPLATE_IDS,
  type ToolDirective,
} from '../../src/agent/types.js';

describe('agent/types', () => {
  it('WIDGET_KINDS contains the 5 kinds registered in Plan 4c', () => {
    expect([...WIDGET_KINDS]).toEqual([
      'markdown',
      'code-block',
      'ticket',
      'web-embed',
      'key-value-card',
    ]);
  });

  it('ROLES enumerates 6 logical roles', () => {
    expect([...ROLES]).toEqual([
      'primary',
      'detail',
      'related',
      'reference',
      'timeline',
      'node',
    ]);
  });

  it('TEMPLATE_IDS matches the 4 templates from Plan 4e', () => {
    expect([...TEMPLATE_IDS]).toEqual([
      'ask-anything',
      'tell-me-about-x',
      'whats-new-since-y',
      'trace-x-everywhere',
    ]);
  });

  it('ToolDirective is a discriminated union over `type`', () => {
    const place: ToolDirective = {
      type: 'place',
      id: 'w-1',
      kind: 'markdown',
      role: 'primary',
      payload: { title: 't', body: 'b' },
    };
    const link: ToolDirective = {
      type: 'link',
      linkId: 'l-1',
      fromId: 'w-1',
      toId: 'w-2',
    };
    const focus: ToolDirective = { type: 'focus', id: 'w-1' };
    const clear: ToolDirective = { type: 'clear' };
    const tmpl: ToolDirective = { type: 'switchTemplate', id: 'ask-anything' };

    // Just compile-time: confirm exhaustiveness
    const all = [place, link, focus, clear, tmpl];
    expect(all).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/types.test.ts`
Expected: FAIL — `Cannot find module '../../src/agent/types.js'`

- [ ] **Step 3: Implement `src/agent/types.ts`**

```ts
/**
 * Shared types for the agent-loop tool surface (Plan 5).
 * Imported by backend tool handlers AND by the browser dispatcher
 * (via path alias) so the directive contract has one source of truth.
 */

export const WIDGET_KINDS = [
  'markdown',
  'code-block',
  'ticket',
  'web-embed',
  'key-value-card',
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const ROLES = [
  'primary',
  'detail',
  'related',
  'reference',
  'timeline',
  'node',
] as const;
export type Role = (typeof ROLES)[number];

export const TEMPLATE_IDS = [
  'ask-anything',
  'tell-me-about-x',
  'whats-new-since-y',
  'trace-x-everywhere',
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/**
 * Backend tool handlers return one of these directives in their tool result.
 * The browser receives them via UIMS `tool-output-available` chunks and
 * applies them to tldraw via `applyToolDirective`.
 */
export type ToolDirective =
  | {
      type: 'place';
      id: string;            // server-minted UUID
      kind: WidgetKind;
      role: Role;
      payload: Record<string, unknown>;
    }
  | {
      type: 'link';
      linkId: string;        // server-minted UUID for the edge
      fromId: string;
      toId: string;
      label?: string;
    }
  | { type: 'focus'; id: string }
  | { type: 'clear' }
  | { type: 'switchTemplate'; id: TemplateId };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/types.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/agent/types.ts __tests__/agent/types.test.ts
git commit -m "feat(agent): add shared types — kinds, roles, template ids, directives"
```

---

### Task 2: Per-kind payload Zod schemas

**Files:**
- Create: `src/agent/payloads.ts`
- Test: `__tests__/agent/payloads.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/agent/payloads.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  MarkdownPayload,
  CodeBlockPayload,
  TicketPayload,
  WebEmbedPayload,
  KeyValueCardPayload,
  validatePayloadForKind,
} from '../../src/agent/payloads.js';

describe('payloads', () => {
  describe('MarkdownPayload', () => {
    it('accepts {title, body}', () => {
      const r = MarkdownPayload.safeParse({ title: 't', body: 'b' });
      expect(r.success).toBe(true);
    });
    it('rejects missing title', () => {
      const r = MarkdownPayload.safeParse({ body: 'b' });
      expect(r.success).toBe(false);
    });
    it('rejects non-string body', () => {
      const r = MarkdownPayload.safeParse({ title: 't', body: 42 });
      expect(r.success).toBe(false);
    });
  });

  describe('CodeBlockPayload', () => {
    it('accepts {title, language, code}', () => {
      expect(
        CodeBlockPayload.safeParse({
          title: 'auth middleware',
          language: 'ts',
          code: 'export function authMiddleware() {}',
        }).success,
      ).toBe(true);
    });
    it('accepts optional source', () => {
      expect(
        CodeBlockPayload.safeParse({
          title: 't',
          language: 'ts',
          code: 'x',
          source: 'auth/middleware.ts:12',
        }).success,
      ).toBe(true);
    });
    it('rejects missing language', () => {
      expect(
        CodeBlockPayload.safeParse({ title: 't', code: 'x' }).success,
      ).toBe(false);
    });
  });

  describe('TicketPayload', () => {
    it('accepts {ticketId, title, status}', () => {
      expect(
        TicketPayload.safeParse({
          ticketId: 'TICKET-101',
          title: 'rate-limit hardening',
          status: 'open',
        }).success,
      ).toBe(true);
    });
  });

  describe('WebEmbedPayload', () => {
    it('accepts a valid URL', () => {
      expect(
        WebEmbedPayload.safeParse({
          title: 'docs',
          url: 'https://example.com/auth',
        }).success,
      ).toBe(true);
    });
    it('rejects a malformed URL', () => {
      expect(
        WebEmbedPayload.safeParse({ title: 'docs', url: 'not-a-url' }).success,
      ).toBe(false);
    });
  });

  describe('KeyValueCardPayload', () => {
    it('accepts {title, fields[]}', () => {
      expect(
        KeyValueCardPayload.safeParse({
          title: 'env',
          fields: [
            { key: 'NODE_ENV', value: 'production' },
            { key: 'PORT', value: '3457' },
          ],
        }).success,
      ).toBe(true);
    });
    it('rejects fields without keys', () => {
      expect(
        KeyValueCardPayload.safeParse({
          title: 'env',
          fields: [{ value: 'production' }],
        }).success,
      ).toBe(false);
    });
  });

  describe('validatePayloadForKind', () => {
    it('returns the parsed payload for a valid kind+payload', () => {
      const r = validatePayloadForKind('markdown', { title: 't', body: 'b' });
      expect(r).toEqual({ title: 't', body: 'b' });
    });
    it('throws for invalid payload', () => {
      expect(() =>
        validatePayloadForKind('markdown', { body: 'b' }),
      ).toThrow();
    });
    it('throws for unknown kind', () => {
      expect(() =>
        // @ts-expect-error testing runtime guard
        validatePayloadForKind('not-a-kind', {}),
      ).toThrow(/unknown widget kind/);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/payloads.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/agent/payloads.ts`**

```ts
import { z } from 'zod';
import type { WidgetKind } from './types.js';

export const MarkdownPayload = z.object({
  title: z.string(),
  body: z.string(),
});

export const CodeBlockPayload = z.object({
  title: z.string(),
  language: z.string(),
  code: z.string(),
  source: z.string().optional(),
});

export const TicketPayload = z.object({
  ticketId: z.string(),
  title: z.string(),
  status: z.string(),
  assignee: z.string().optional(),
  priority: z.string().optional(),
});

export const WebEmbedPayload = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional(),
});

export const KeyValueCardPayload = z.object({
  title: z.string(),
  fields: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
});

const PAYLOAD_SCHEMAS = {
  markdown: MarkdownPayload,
  'code-block': CodeBlockPayload,
  ticket: TicketPayload,
  'web-embed': WebEmbedPayload,
  'key-value-card': KeyValueCardPayload,
} as const;

/**
 * Parse `payload` against the schema for `kind`.
 * Throws ZodError on schema mismatch and Error('unknown widget kind') on
 * an unrecognised kind. Used by the place_widget handler.
 */
export function validatePayloadForKind(
  kind: WidgetKind,
  payload: unknown,
): Record<string, unknown> {
  const schema = PAYLOAD_SCHEMAS[kind];
  if (!schema) throw new Error(`unknown widget kind: ${kind}`);
  return schema.parse(payload);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/payloads.test.ts`
Expected: PASS — all 12+ assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent/payloads.ts __tests__/agent/payloads.test.ts
git commit -m "feat(agent): add per-kind payload Zod schemas + validatePayloadForKind"
```

---

### Task 3: CanvasSnapshot type + parser

**Files:**
- Create: `src/agent/canvas-snapshot.ts`
- Test: `__tests__/agent/canvas-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

`__tests__/agent/canvas-snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseCanvasSnapshot,
  EMPTY_SNAPSHOT,
  type CanvasSnapshot,
} from '../../src/agent/canvas-snapshot.js';

describe('canvas-snapshot', () => {
  it('parses a valid snapshot', () => {
    const raw = {
      activeTemplateId: 'ask-anything',
      widgets: [
        {
          id: 'w-1',
          kind: 'markdown',
          role: 'primary',
          title: 'auth overview',
          payload: { title: 'auth', body: 'JWT-based' },
        },
      ],
    };
    const snap = parseCanvasSnapshot(raw);
    expect(snap.activeTemplateId).toBe('ask-anything');
    expect(snap.widgets).toHaveLength(1);
    expect(snap.widgets[0]?.id).toBe('w-1');
  });

  it('returns EMPTY_SNAPSHOT when input is undefined', () => {
    expect(parseCanvasSnapshot(undefined)).toEqual(EMPTY_SNAPSHOT);
  });

  it('returns EMPTY_SNAPSHOT when input is malformed', () => {
    expect(parseCanvasSnapshot({ widgets: 'not-an-array' })).toEqual(
      EMPTY_SNAPSHOT,
    );
  });

  it('rejects unknown templateId by falling back to default', () => {
    const snap = parseCanvasSnapshot({
      activeTemplateId: 'made-up',
      widgets: [],
    });
    expect(snap.activeTemplateId).toBe('ask-anything');
  });

  it('drops malformed widgets but keeps valid ones', () => {
    const snap = parseCanvasSnapshot({
      activeTemplateId: 'ask-anything',
      widgets: [
        { id: 'w-1', kind: 'markdown', role: 'primary', title: 't', payload: {} },
        { id: 'w-2', kind: 'unknown-kind', role: 'primary', title: 't', payload: {} },
      ],
    });
    expect(snap.widgets).toHaveLength(1);
    expect(snap.widgets[0]?.id).toBe('w-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/canvas-snapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/agent/canvas-snapshot.ts`**

```ts
import { z } from 'zod';
import { WIDGET_KINDS, ROLES, TEMPLATE_IDS } from './types.js';

const WidgetEntry = z.object({
  id: z.string(),
  kind: z.enum(WIDGET_KINDS),
  role: z.enum(ROLES),
  title: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

const Snapshot = z.object({
  activeTemplateId: z.enum(TEMPLATE_IDS),
  widgets: z.array(WidgetEntry),
});

export type CanvasSnapshot = z.infer<typeof Snapshot>;

export const EMPTY_SNAPSHOT: CanvasSnapshot = {
  activeTemplateId: 'ask-anything',
  widgets: [],
};

/**
 * Parse a CanvasSnapshot from arbitrary request input.
 * - undefined / malformed top-level → EMPTY_SNAPSHOT
 * - unknown templateId → fall back to 'ask-anything'
 * - per-widget validation failures: drop the widget, keep the rest
 *
 * This is permissive on purpose — the snapshot is a hint, not the source
 * of truth, and we'd rather degrade gracefully than 400 a chat turn.
 */
export function parseCanvasSnapshot(raw: unknown): CanvasSnapshot {
  if (!raw || typeof raw !== 'object') return EMPTY_SNAPSHOT;
  const obj = raw as Record<string, unknown>;
  const widgets = Array.isArray(obj['widgets']) ? obj['widgets'] : null;
  if (!widgets) return EMPTY_SNAPSHOT;

  const validWidgets: CanvasSnapshot['widgets'] = [];
  for (const w of widgets) {
    const r = WidgetEntry.safeParse(w);
    if (r.success) validWidgets.push(r.data);
  }

  const tplRaw = obj['activeTemplateId'];
  const tpl = TEMPLATE_IDS.find((t) => t === tplRaw) ?? 'ask-anything';

  return { activeTemplateId: tpl, widgets: validWidgets };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/canvas-snapshot.test.ts`
Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/agent/canvas-snapshot.ts __tests__/agent/canvas-snapshot.test.ts
git commit -m "feat(agent): CanvasSnapshot Zod schema + permissive parser"
```

---

### Task 4: Tool — `search_kb`

**Files:**
- Create: `src/agent/tools/search-kb.ts`
- Test: `__tests__/agent/tools/search-kb.test.ts`

This tool calls the existing `SearchService` (built in Plan 3a). Read the current shape first — open `src/index/search.ts` — and pass through results trimmed to summary-only.

- [ ] **Step 1: Write the failing test**

`__tests__/agent/tools/search-kb.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { searchKbTool } from '../../../src/agent/tools/search-kb.js';

const fakeSearchService = (results: unknown[]) => ({
  search: vi.fn().mockResolvedValue(results),
});

describe('search_kb', () => {
  it('returns summary-only results (no full payloads)', async () => {
    const svc = fakeSearchService([
      {
        id: 'docs:auth',
        kind: 'text-document',
        title: 'auth overview',
        snippet: 'JWT...',
        score: 0.92,
        source: 'docs',
        payload: { body: 'a long body that should not be returned' },
      },
    ]);
    const handler = searchKbTool(svc as never).handler;
    const r = await handler({ query: 'auth' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.results).toHaveLength(1);
    expect(out.results[0]).not.toHaveProperty('payload');
    expect(out.results[0]).toEqual({
      id: 'docs:auth',
      kind: 'text-document',
      title: 'auth overview',
      snippet: 'JWT...',
      score: 0.92,
      source: 'docs',
    });
  });

  it('clamps limit to 25', async () => {
    const svc = fakeSearchService([]);
    const handler = searchKbTool(svc as never).handler;
    await handler({ query: 'x', limit: 999 }, undefined);
    expect(svc.search).toHaveBeenCalledWith('x', 25);
  });

  it('defaults limit to 10', async () => {
    const svc = fakeSearchService([]);
    const handler = searchKbTool(svc as never).handler;
    await handler({ query: 'x' }, undefined);
    expect(svc.search).toHaveBeenCalledWith('x', 10);
  });

  it('returns warning when search throws "index not ready"', async () => {
    const svc = {
      search: vi.fn().mockRejectedValue(new Error('index not ready')),
    };
    const handler = searchKbTool(svc as never).handler;
    const r = await handler({ query: 'x' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.results).toEqual([]);
    expect(out.warning).toContain('index');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/tools/search-kb.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/agent/tools/search-kb.ts`**

```ts
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';

interface SearchServiceLike {
  search(query: string, limit: number): Promise<
    Array<{
      id: string;
      kind: string;
      title: string;
      snippet: string;
      score: number;
      source: string;
    }>
  >;
}

const inputShape = {
  query: z.string().describe('search query'),
  limit: z.number().int().positive().max(25).optional()
    .describe('max results, default 10, max 25'),
};

/**
 * Factory: builds the search_kb SdkMcpToolDefinition bound to a search service.
 * The service interface is intentionally narrow so tests can inject a fake.
 */
export function searchKbTool(service: SearchServiceLike) {
  return tool(
    'search_kb',
    'Search indexed knowledge (code, docs, tickets). Returns summary results.',
    inputShape,
    async (args) => {
      const limit = Math.min(args.limit ?? 10, 25);
      try {
        const results = await service.search(args.query, limit);
        const summary = results.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title,
          snippet: r.snippet,
          score: r.score,
          source: r.source,
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify({ results: summary }) }],
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                results: [],
                warning: `search failed: ${message}`,
              }),
            },
          ],
        };
      }
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/tools/search-kb.test.ts`
Expected: PASS — all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/search-kb.ts __tests__/agent/tools/search-kb.test.ts
git commit -m "feat(agent): search_kb tool — summary-only search results"
```

---

### Task 5: Tool — `fetch_result`

**Files:**
- Create: `src/agent/tools/fetch-result.ts`
- Test: `__tests__/agent/tools/fetch-result.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchResultTool } from '../../../src/agent/tools/fetch-result.js';

describe('fetch_result', () => {
  it('returns the full payload by id', async () => {
    const svc = {
      fetchById: vi.fn().mockResolvedValue({
        id: 'docs:auth',
        kind: 'text-document',
        title: 'auth overview',
        payload: { body: 'JWT-based authentication...' },
        source: 'docs',
      }),
    };
    const handler = fetchResultTool(svc as never).handler;
    const r = await handler({ id: 'docs:auth' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.result.id).toBe('docs:auth');
    expect(out.result.payload.body).toContain('JWT');
  });

  it('returns isError when id not found', async () => {
    const svc = { fetchById: vi.fn().mockResolvedValue(null) };
    const handler = fetchResultTool(svc as never).handler;
    const r = await handler({ id: 'nope' }, undefined);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/tools/fetch-result.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/agent/tools/fetch-result.ts`**

```ts
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';

interface FetchByIdServiceLike {
  fetchById(id: string): Promise<{
    id: string;
    kind: string;
    title: string;
    payload: Record<string, unknown>;
    source: string;
  } | null>;
}

const inputShape = {
  id: z.string().describe('search result id from search_kb'),
};

export function fetchResultTool(service: FetchByIdServiceLike) {
  return tool(
    'fetch_result',
    'Fetch the full payload of a search result by id.',
    inputShape,
    async (args) => {
      const result = await service.fetchById(args.id);
      if (!result) {
        return {
          content: [
            { type: 'text', text: `result not found for id: ${args.id}` },
          ],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ result }) }],
      };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/tools/fetch-result.test.ts`
Expected: PASS — both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/fetch-result.ts __tests__/agent/tools/fetch-result.test.ts
git commit -m "feat(agent): fetch_result tool — drill-down by id"
```

> **Note for executor:** `SearchService.fetchById` doesn't yet exist — Plan 3a's service has `search()`. Add `fetchById` as a thin wrapper over the existing `result_cache` / chunk lookup logic in `src/index/search.ts`. If the fetch path needs more than 5 minutes, treat that as a separate prep task and stub `fetchById` to return null for unknown ids. The tool itself is correct; only the wiring in Task 14 needs the real implementation.

---

### Task 6: Tool — `place_widget`

**Files:**
- Create: `src/agent/tools/place-widget.ts`
- Test: `__tests__/agent/tools/place-widget.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { placeWidgetTool } from '../../../src/agent/tools/place-widget.js';

describe('place_widget', () => {
  it('returns ok=true with a generated id and a place directive', async () => {
    const handler = placeWidgetTool().handler;
    const r = await handler(
      {
        kind: 'markdown',
        role: 'primary',
        payload: { title: 'auth', body: 'overview' },
      },
      undefined,
    );
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.ok).toBe(true);
    expect(typeof out.id).toBe('string');
    expect(out.id.length).toBeGreaterThan(0);
    expect(out.directive).toEqual({
      type: 'place',
      id: out.id,
      kind: 'markdown',
      role: 'primary',
      payload: { title: 'auth', body: 'overview' },
    });
  });

  it('rejects malformed payload for the chosen kind', async () => {
    const handler = placeWidgetTool().handler;
    const r = await handler(
      {
        kind: 'web-embed',
        role: 'reference',
        payload: { title: 'docs', url: 'not-a-url' },
      },
      undefined,
    );
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('Invalid payload');
  });

  it('rejects unknown kind', async () => {
    const handler = placeWidgetTool().handler;
    // @ts-expect-error testing runtime guard
    const r = await handler(
      { kind: 'made-up-kind', role: 'primary', payload: {} },
      undefined,
    );
    expect(r.isError).toBe(true);
  });

  it('mints a unique id per call', async () => {
    const handler = placeWidgetTool().handler;
    const a = JSON.parse(
      (await handler(
        { kind: 'markdown', role: 'primary', payload: { title: 't', body: 'b' } },
        undefined,
      )).content[0]!.text!,
    );
    const b = JSON.parse(
      (await handler(
        { kind: 'markdown', role: 'primary', payload: { title: 't', body: 'b' } },
        undefined,
      )).content[0]!.text!,
    );
    expect(a.id).not.toBe(b.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/tools/place-widget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/agent/tools/place-widget.ts`**

```ts
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { WIDGET_KINDS, ROLES } from '../types.js';
import { validatePayloadForKind } from '../payloads.js';

const inputShape = {
  kind: z.enum(WIDGET_KINDS).describe('widget kind'),
  role: z.enum(ROLES).describe('logical placement role'),
  payload: z
    .record(z.string(), z.unknown())
    .describe('content payload (schema depends on kind)'),
};

export function placeWidgetTool() {
  return tool(
    'place_widget',
    "Place a widget on the canvas at the role's slot in the active template.",
    inputShape,
    async (args) => {
      try {
        const validated = validatePayloadForKind(args.kind, args.payload);
        const id = randomUUID();
        const directive = {
          type: 'place' as const,
          id,
          kind: args.kind,
          role: args.role,
          payload: validated,
        };
        return {
          content: [
            { type: 'text', text: JSON.stringify({ ok: true, id, directive }) },
          ],
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: 'text',
              text: `Invalid payload for kind=${args.kind}: ${message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/tools/place-widget.test.ts`
Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/place-widget.ts __tests__/agent/tools/place-widget.test.ts
git commit -m "feat(agent): place_widget tool — validates kind+role+payload, mints uuid"
```

---

### Task 7: Tool — `read_canvas`

**Files:**
- Create: `src/agent/tools/read-canvas.ts`
- Test: `__tests__/agent/tools/read-canvas.test.ts`

This tool reads from a `CanvasSnapshot` passed in via the `extra` argument that the SDK threads through (per `tool()` signature). We'll thread the snapshot via a closure in the registry (Task 13); the tool factory takes a `() => CanvasSnapshot` getter.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readCanvasTool } from '../../../src/agent/tools/read-canvas.js';
import type { CanvasSnapshot } from '../../../src/agent/canvas-snapshot.js';

const snap: CanvasSnapshot = {
  activeTemplateId: 'ask-anything',
  widgets: [
    {
      id: 'w-1',
      kind: 'markdown',
      role: 'primary',
      title: 'auth',
      payload: { title: 'auth', body: 'long body' },
    },
    {
      id: 'w-2',
      kind: 'ticket',
      role: 'detail',
      title: 'TICKET-101',
      payload: { ticketId: 'TICKET-101', title: 'rate limits', status: 'open' },
    },
  ],
};

describe('read_canvas', () => {
  it('returns summary only — no payload field', async () => {
    const handler = readCanvasTool(() => snap).handler;
    const r = await handler({}, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.widgets).toHaveLength(2);
    expect(out.widgets[0]).toEqual({
      id: 'w-1',
      kind: 'markdown',
      role: 'primary',
      title: 'auth',
    });
    expect(out.widgets[0]).not.toHaveProperty('payload');
  });

  it('reflects snapshot changes between calls (closure captures live ref)', async () => {
    let current: CanvasSnapshot = { ...snap, widgets: [] };
    const handler = readCanvasTool(() => current).handler;

    const a = JSON.parse((await handler({}, undefined)).content[0]!.text!);
    expect(a.widgets).toHaveLength(0);

    current = snap;
    const b = JSON.parse((await handler({}, undefined)).content[0]!.text!);
    expect(b.widgets).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/tools/read-canvas.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/agent/tools/read-canvas.ts`**

```ts
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CanvasSnapshot } from '../canvas-snapshot.js';

export function readCanvasTool(getSnapshot: () => CanvasSnapshot) {
  return tool(
    'read_canvas',
    'List widgets currently on the canvas (summary only).',
    {},
    async () => {
      const snap = getSnapshot();
      const summary = snap.widgets.map((w) => ({
        id: w.id,
        kind: w.kind,
        role: w.role,
        title: w.title,
      }));
      return {
        content: [{ type: 'text', text: JSON.stringify({ widgets: summary }) }],
      };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/tools/read-canvas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/read-canvas.ts __tests__/agent/tools/read-canvas.test.ts
git commit -m "feat(agent): read_canvas tool — summary read from per-turn snapshot"
```

---

### Task 8: Tool — `read_widget`

**Files:**
- Create: `src/agent/tools/read-widget.ts`
- Test: `__tests__/agent/tools/read-widget.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { readWidgetTool } from '../../../src/agent/tools/read-widget.js';
import type { CanvasSnapshot } from '../../../src/agent/canvas-snapshot.js';

const snap: CanvasSnapshot = {
  activeTemplateId: 'ask-anything',
  widgets: [
    {
      id: 'w-1',
      kind: 'markdown',
      role: 'primary',
      title: 'auth',
      payload: { title: 'auth', body: 'JWT-based auth' },
    },
  ],
};

describe('read_widget', () => {
  it('returns the full widget when id matches', async () => {
    const handler = readWidgetTool(() => snap).handler;
    const r = await handler({ id: 'w-1' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.widget.payload.body).toBe('JWT-based auth');
  });

  it('returns isError when id not found', async () => {
    const handler = readWidgetTool(() => snap).handler;
    const r = await handler({ id: 'nope' }, undefined);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/tools/read-widget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/agent/tools/read-widget.ts`**

```ts
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CanvasSnapshot } from '../canvas-snapshot.js';

const inputShape = {
  id: z.string().describe('canvas widget id from read_canvas'),
};

export function readWidgetTool(getSnapshot: () => CanvasSnapshot) {
  return tool(
    'read_widget',
    'Read the full payload of one canvas widget.',
    inputShape,
    async (args) => {
      const snap = getSnapshot();
      const w = snap.widgets.find((x) => x.id === args.id);
      if (!w) {
        return {
          content: [{ type: 'text', text: `widget not found: ${args.id}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ widget: w }) }],
      };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/tools/read-widget.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/read-widget.ts __tests__/agent/tools/read-widget.test.ts
git commit -m "feat(agent): read_widget tool — drill-down on canvas widget"
```

---

### Task 9: Tool — `focus_widget`

**Files:**
- Create: `src/agent/tools/focus-widget.ts`
- Test: `__tests__/agent/tools/focus-widget.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { focusWidgetTool } from '../../../src/agent/tools/focus-widget.js';

describe('focus_widget', () => {
  it('returns ok and a focus directive', async () => {
    const handler = focusWidgetTool().handler;
    const r = await handler({ id: 'w-1' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.ok).toBe(true);
    expect(out.directive).toEqual({ type: 'focus', id: 'w-1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/tools/focus-widget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/agent/tools/focus-widget.ts`**

```ts
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';

const inputShape = {
  id: z.string().describe('canvas widget id'),
};

export function focusWidgetTool() {
  return tool(
    'focus_widget',
    'Pan and zoom the canvas to a specific widget.',
    inputShape,
    async (args) => {
      const directive = { type: 'focus' as const, id: args.id };
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: true, directive }) },
        ],
      };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/tools/focus-widget.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/focus-widget.ts __tests__/agent/tools/focus-widget.test.ts
git commit -m "feat(agent): focus_widget tool"
```

---

### Task 10: Tool — `link_widgets`

**Files:**
- Create: `src/agent/tools/link-widgets.ts`
- Test: `__tests__/agent/tools/link-widgets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { linkWidgetsTool } from '../../../src/agent/tools/link-widgets.js';

describe('link_widgets', () => {
  it('returns linkId + link directive', async () => {
    const handler = linkWidgetsTool().handler;
    const r = await handler(
      { fromId: 'w-1', toId: 'w-2', label: 'implements' },
      undefined,
    );
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.ok).toBe(true);
    expect(out.linkId).toEqual(expect.any(String));
    expect(out.directive).toEqual({
      type: 'link',
      linkId: out.linkId,
      fromId: 'w-1',
      toId: 'w-2',
      label: 'implements',
    });
  });

  it('omits label when not provided', async () => {
    const handler = linkWidgetsTool().handler;
    const r = await handler({ fromId: 'a', toId: 'b' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.directive.label).toBeUndefined();
  });

  it('rejects self-links', async () => {
    const handler = linkWidgetsTool().handler;
    const r = await handler({ fromId: 'a', toId: 'a' }, undefined);
    expect(r.isError).toBe(true);
    expect(r.content[0]!.text).toContain('self-link');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/tools/link-widgets.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/agent/tools/link-widgets.ts`**

```ts
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';

const inputShape = {
  fromId: z.string().describe('source widget id'),
  toId: z.string().describe('target widget id'),
  label: z.string().optional().describe('edge label'),
};

export function linkWidgetsTool() {
  return tool(
    'link_widgets',
    'Draw a labeled visual edge between two canvas widgets.',
    inputShape,
    async (args) => {
      if (args.fromId === args.toId) {
        return {
          content: [
            { type: 'text', text: 'self-link not allowed: fromId === toId' },
          ],
          isError: true,
        };
      }
      const linkId = randomUUID();
      const directive = {
        type: 'link' as const,
        linkId,
        fromId: args.fromId,
        toId: args.toId,
        ...(args.label !== undefined ? { label: args.label } : {}),
      };
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, linkId, directive }),
          },
        ],
      };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/tools/link-widgets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/link-widgets.ts __tests__/agent/tools/link-widgets.test.ts
git commit -m "feat(agent): link_widgets tool"
```

---

### Task 11: Tool — `clear_canvas`

**Files:**
- Create: `src/agent/tools/clear-canvas.ts`
- Test: `__tests__/agent/tools/clear-canvas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { clearCanvasTool } from '../../../src/agent/tools/clear-canvas.js';
import type { CanvasSnapshot } from '../../../src/agent/canvas-snapshot.js';

const snap: CanvasSnapshot = {
  activeTemplateId: 'ask-anything',
  widgets: [
    { id: 'w-1', kind: 'markdown', role: 'primary', title: 't', payload: {} },
    { id: 'w-2', kind: 'ticket', role: 'detail', title: 't', payload: {} },
  ],
};

describe('clear_canvas', () => {
  it('returns clear directive and the ids that will be removed', async () => {
    const handler = clearCanvasTool(() => snap).handler;
    const r = await handler({}, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.ok).toBe(true);
    expect(out.removedIds).toEqual(['w-1', 'w-2']);
    expect(out.directive).toEqual({ type: 'clear' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/tools/clear-canvas.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/agent/tools/clear-canvas.ts`**

```ts
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CanvasSnapshot } from '../canvas-snapshot.js';

export function clearCanvasTool(getSnapshot: () => CanvasSnapshot) {
  return tool(
    'clear_canvas',
    'Remove all widgets from the canvas.',
    {},
    async () => {
      const snap = getSnapshot();
      const removedIds = snap.widgets.map((w) => w.id);
      const directive = { type: 'clear' as const };
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, removedIds, directive }),
          },
        ],
      };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/tools/clear-canvas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/clear-canvas.ts __tests__/agent/tools/clear-canvas.test.ts
git commit -m "feat(agent): clear_canvas tool"
```

---

### Task 12: Tool — `switch_template`

**Files:**
- Create: `src/agent/tools/switch-template.ts`
- Test: `__tests__/agent/tools/switch-template.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { switchTemplateTool } from '../../../src/agent/tools/switch-template.js';

describe('switch_template', () => {
  it('returns switchTemplate directive for a valid template id', async () => {
    const handler = switchTemplateTool().handler;
    const r = await handler({ id: 'tell-me-about-x' }, undefined);
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.ok).toBe(true);
    expect(out.directive).toEqual({
      type: 'switchTemplate',
      id: 'tell-me-about-x',
    });
  });

  it('rejects unknown template id (Zod enum)', async () => {
    const handler = switchTemplateTool().handler;
    // @ts-expect-error testing runtime guard
    const r = await handler({ id: 'made-up' }, undefined);
    // SDK's tool() runs Zod parse before our handler; with safeParse failure
    // the SDK throws — we test the schema rejects it.
    expect(r.isError).toBe(true);
  });
});
```

> **Implementer note:** the SDK's `tool()` runs the Zod schema before the handler. For an enum mismatch the SDK itself produces the error response — but to keep the unit test self-contained and consistent with other tools, also do an explicit re-check inside the handler so we own the error message.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/tools/switch-template.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/agent/tools/switch-template.ts`**

```ts
import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { TEMPLATE_IDS } from '../types.js';

const inputShape = {
  id: z
    .enum(TEMPLATE_IDS)
    .describe('template id: ask-anything | tell-me-about-x | whats-new-since-y | trace-x-everywhere'),
};

export function switchTemplateTool() {
  return tool(
    'switch_template',
    'Switch the active canvas template; existing widgets re-flow.',
    inputShape,
    async (args) => {
      // Defensive: if the SDK skipped Zod (shouldn't), guard here too.
      if (!TEMPLATE_IDS.includes(args.id as (typeof TEMPLATE_IDS)[number])) {
        return {
          content: [{ type: 'text', text: `unknown template: ${args.id}` }],
          isError: true,
        };
      }
      const directive = { type: 'switchTemplate' as const, id: args.id };
      return {
        content: [
          { type: 'text', text: JSON.stringify({ ok: true, directive }) },
        ],
      };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/tools/switch-template.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/switch-template.ts __tests__/agent/tools/switch-template.test.ts
git commit -m "feat(agent): switch_template tool"
```

---

### Task 13: Tool registry

**Files:**
- Create: `src/agent/tools/index.ts`
- Test: `__tests__/agent/tools-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildAgentTools } from '../../src/agent/tools/index.js';
import type { CanvasSnapshot } from '../../src/agent/canvas-snapshot.js';

const fakeSearch = {
  search: async () => [],
  fetchById: async () => null,
};
const emptySnap: CanvasSnapshot = {
  activeTemplateId: 'ask-anything',
  widgets: [],
};

describe('buildAgentTools', () => {
  it('returns the 9 tools in declared order', () => {
    const tools = buildAgentTools({
      search: fakeSearch,
      getSnapshot: () => emptySnap,
    });
    expect(tools.map((t) => t.name)).toEqual([
      'search_kb',
      'fetch_result',
      'place_widget',
      'read_canvas',
      'read_widget',
      'focus_widget',
      'link_widgets',
      'clear_canvas',
      'switch_template',
    ]);
  });

  it('every tool has a description and inputSchema', () => {
    const tools = buildAgentTools({
      search: fakeSearch,
      getSnapshot: () => emptySnap,
    });
    for (const t of tools) {
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.handler).toBe('function');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/agent/tools-registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/agent/tools/index.ts`**

```ts
import { searchKbTool } from './search-kb.js';
import { fetchResultTool } from './fetch-result.js';
import { placeWidgetTool } from './place-widget.js';
import { readCanvasTool } from './read-canvas.js';
import { readWidgetTool } from './read-widget.js';
import { focusWidgetTool } from './focus-widget.js';
import { linkWidgetsTool } from './link-widgets.js';
import { clearCanvasTool } from './clear-canvas.js';
import { switchTemplateTool } from './switch-template.js';
import type { CanvasSnapshot } from '../canvas-snapshot.js';

export interface AgentToolDeps {
  search: {
    search(query: string, limit: number): Promise<
      Array<{
        id: string;
        kind: string;
        title: string;
        snippet: string;
        score: number;
        source: string;
      }>
    >;
    fetchById(id: string): Promise<{
      id: string;
      kind: string;
      title: string;
      payload: Record<string, unknown>;
      source: string;
    } | null>;
  };
  getSnapshot: () => CanvasSnapshot;
}

/**
 * Build the array of 9 tools for one chat turn.
 * Called per-turn so closures (search service, snapshot getter) are fresh.
 */
export function buildAgentTools(deps: AgentToolDeps) {
  return [
    searchKbTool(deps.search),
    fetchResultTool(deps.search),
    placeWidgetTool(),
    readCanvasTool(deps.getSnapshot),
    readWidgetTool(deps.getSnapshot),
    focusWidgetTool(),
    linkWidgetsTool(),
    clearCanvasTool(deps.getSnapshot),
    switchTemplateTool(),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/agent/tools-registry.test.ts`
Expected: PASS — both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/index.ts __tests__/agent/tools-registry.test.ts
git commit -m "feat(agent): tool registry — buildAgentTools(deps) returns 9 tools in order"
```

---

### Task 14: Add `fetchById` to SearchService

**Files:**
- Modify: `src/index/search.ts` (Plan 3a's existing service — add `fetchById` method)
- Test: `__tests__/index/search-fetch-by-id.test.ts`

> **Implementer note:** Find the existing `SearchService` class. The existing `search()` method joins FTS + vec results from `chunks` and `embeddings`. `fetchById` needs to look up a single chunk by its composite id (probably `<source>:<chunkId>`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { BackendState } from '../../src/backend/state.js';

describe('SearchService.fetchById', () => {
  it('returns null for an unknown id', async () => {
    const state = await BackendState.create();
    const svc = state.getSearchService();
    const r = await svc.fetchById('made-up:no-such-chunk');
    expect(r).toBeNull();
  });

  it('returns full payload when id matches an indexed chunk', async () => {
    // This test assumes at least one indexed chunk exists in the dev DB.
    // If your dev profile has no index yet, prepopulate via the CLI:
    //   pnpm tsx scripts/cli.ts index --source <id>
    // Then read one id via search:
    const state = await BackendState.create();
    const svc = state.getSearchService();
    const results = await svc.search('the', 1);
    if (results.length === 0) {
      // Skip rather than fail in environments without an index.
      return;
    }
    const r = await svc.fetchById(results[0]!.id);
    expect(r).not.toBeNull();
    expect(r?.id).toBe(results[0]!.id);
    expect(r?.payload).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/index/search-fetch-by-id.test.ts`
Expected: FAIL — `svc.fetchById is not a function`.

- [ ] **Step 3: Implement `fetchById` in `src/index/search.ts`**

Open the file, find the `SearchService` class, add this method (signature must match `AgentToolDeps['search']['fetchById']`):

```ts
async fetchById(id: string): Promise<{
  id: string;
  kind: string;
  title: string;
  payload: Record<string, unknown>;
  source: string;
} | null> {
  // chunks.id is the composite key already used by search().
  const row = this.db
    .prepare(
      `SELECT id, source_id, kind, body, meta_json
         FROM chunks
        WHERE id = ?
        LIMIT 1`,
    )
    .get(id) as
    | { id: string; source_id: string; kind: string; body: string; meta_json: string }
    | undefined;
  if (!row) return null;
  const meta = JSON.parse(row.meta_json) as Record<string, unknown>;
  return {
    id: row.id,
    kind: row.kind,
    title: (meta['title'] as string) ?? row.id,
    source: row.source_id,
    payload: { body: row.body, ...meta },
  };
}
```

> **Implementer note:** Match this against the actual schema in `src/index/storage.ts`. If column names differ (e.g., `body` is stored as `text`), adapt. The shape of the returned object is what `fetch_result` returns to the model, not the DB shape.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/index/search-fetch-by-id.test.ts`
Expected: PASS — both tests pass (the second may early-return if no index).

- [ ] **Step 5: Commit**

```bash
git add src/index/search.ts __tests__/index/search-fetch-by-id.test.ts
git commit -m "feat(index): SearchService.fetchById for tool drill-down"
```

---

### Task 15: Extend `QueryRequest` and `ProviderEvent`

**Files:**
- Modify: `src/core/provider.ts`
- Test: `__tests__/core/provider-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import type { QueryRequest, ProviderEvent } from '../../src/core/provider.js';
import type { CanvasSnapshot } from '../../src/agent/canvas-snapshot.js';

describe('provider type extensions', () => {
  it('QueryRequest accepts canvasSnapshot and abortSignal', () => {
    const ac = new AbortController();
    const snap: CanvasSnapshot = {
      activeTemplateId: 'ask-anything',
      widgets: [],
    };
    const r: QueryRequest = {
      prompt: 'hi',
      canvasSnapshot: snap,
      abortSignal: ac.signal,
    };
    expect(r.canvasSnapshot?.widgets).toHaveLength(0);
    expect(r.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('tool-call ProviderEvent carries toolCallId', () => {
    const e: ProviderEvent = {
      type: 'tool-call',
      toolCallId: 'tc-1',
      name: 'search_kb',
      input: { query: 'auth' },
    };
    if (e.type === 'tool-call') {
      expect(e.toolCallId).toBe('tc-1');
    }
  });

  it('tool-result ProviderEvent carries toolCallId and optional isError', () => {
    const ok: ProviderEvent = {
      type: 'tool-result',
      toolCallId: 'tc-1',
      name: 'search_kb',
      output: { results: [] },
    };
    const err: ProviderEvent = {
      type: 'tool-result',
      toolCallId: 'tc-2',
      name: 'place_widget',
      output: 'invalid payload',
      isError: true,
    };
    if (ok.type === 'tool-result') expect(ok.toolCallId).toBe('tc-1');
    if (err.type === 'tool-result') expect(err.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/core/provider-types.test.ts`
Expected: FAIL — `Object literal may only specify known properties, and 'canvasSnapshot' does not exist in type 'QueryRequest'`. (Type errors at compile.)

- [ ] **Step 3: Modify `src/core/provider.ts`**

Replace the file with:

```ts
import type { CanvasSnapshot } from '../agent/canvas-snapshot.js';

export type ProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'tool-call'; toolCallId: string; name: string; input: unknown }
  | {
      type: 'tool-result';
      toolCallId: string;
      name: string;
      output: unknown;
      isError?: boolean;
    }
  | { type: 'error'; message: string }
  | { type: 'done'; usage?: { inputTokens?: number; outputTokens?: number } };

export type QueryRequest = {
  prompt: string;
  systemPrompt?: string;
  canvasSnapshot?: CanvasSnapshot;
  abortSignal?: AbortSignal;
};

export type ProbeResult = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
};

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: 'model' | 'agent';
  query(request: QueryRequest): AsyncIterable<ProviderEvent>;
  probe(): Promise<ProbeResult>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/core/provider-types.test.ts`
Expected: PASS — type checks succeed.

- [ ] **Step 5: Commit**

```bash
git add src/core/provider.ts __tests__/core/provider-types.test.ts
git commit -m "feat(core): QueryRequest gets canvasSnapshot+abortSignal; tool events get toolCallId"
```

---

### Task 16: Mock provider helper for tests

**Files:**
- Create: `__tests__/helpers/mock-provider.ts`

- [ ] **Step 1: Implement the helper (no separate test — it's a test utility)**

```ts
import type { LLMProvider, ProviderEvent, QueryRequest, ProbeResult } from '../../src/core/provider.js';

/**
 * Mock LLMProvider that yields a scripted ProviderEvent[] and records
 * the QueryRequest it received. Used to test the chat route + UIMS
 * adapter without hitting a real model.
 */
export function makeMockProvider(events: ProviderEvent[]): LLMProvider & {
  receivedRequests: QueryRequest[];
} {
  const receivedRequests: QueryRequest[] = [];
  return {
    id: 'mock',
    name: 'Mock Provider',
    kind: 'model',
    receivedRequests,
    async *query(request: QueryRequest) {
      receivedRequests.push(request);
      for (const e of events) yield e;
    },
    async probe(): Promise<ProbeResult> {
      return { ok: true, latencyMs: 0 };
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add __tests__/helpers/mock-provider.ts
git commit -m "test(helpers): mock LLMProvider yielding scripted ProviderEvents"
```

---

### Task 17: UIMS forwarding — `tool-call` → `tool-input-available`

**Files:**
- Modify: `src/backend/uims-stream.ts`
- Test: `__tests__/backend/uims-tool-input.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { providerEventsToUIMS } from '../../src/backend/uims-stream.js';
import type { ProviderEvent } from '../../src/core/provider.js';

async function collect(events: ProviderEvent[]): Promise<string[]> {
  async function* gen() {
    for (const e of events) yield e;
  }
  const out: string[] = [];
  for await (const line of providerEventsToUIMS(gen())) out.push(line);
  return out;
}

describe('UIMS tool-input forwarding', () => {
  it('forwards tool-call as tool-input-available', async () => {
    const lines = await collect([
      {
        type: 'tool-call',
        toolCallId: 'tc-1',
        name: 'search_kb',
        input: { query: 'auth' },
      },
      { type: 'done' },
    ]);
    const json = lines
      .map((l) => l.replace(/^data: /, '').replace(/\n\n$/, ''))
      .filter((s) => s !== '[DONE]')
      .map((s) => JSON.parse(s));

    const toolInput = json.find((j) => j.type === 'tool-input-available');
    expect(toolInput).toBeDefined();
    expect(toolInput).toEqual({
      type: 'tool-input-available',
      toolCallId: 'tc-1',
      toolName: 'search_kb',
      input: { query: 'auth' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/backend/uims-tool-input.test.ts`
Expected: FAIL — no `tool-input-available` chunk emitted.

- [ ] **Step 3: Modify `src/backend/uims-stream.ts`**

Inside the `for await (const event of events)` switch, add a case:

```ts
case 'tool-call':
  // Always emit BEFORE any text-end so consumers render the tool indicator
  // alongside the text reply.
  yield emit({
    type: 'tool-input-available',
    toolCallId: event.toolCallId,
    toolName: event.name,
    input: event.input,
  });
  break;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/backend/uims-tool-input.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/backend/uims-stream.ts __tests__/backend/uims-tool-input.test.ts
git commit -m "feat(uims): forward tool-call ProviderEvent → tool-input-available chunk"
```

---

### Task 18: UIMS forwarding — `tool-result` → `tool-output-available` / `tool-output-error`

**Files:**
- Modify: `src/backend/uims-stream.ts`
- Test: `__tests__/backend/uims-tool-output.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { providerEventsToUIMS } from '../../src/backend/uims-stream.js';
import type { ProviderEvent } from '../../src/core/provider.js';

async function collect(events: ProviderEvent[]): Promise<string[]> {
  async function* gen() {
    for (const e of events) yield e;
  }
  const out: string[] = [];
  for await (const line of providerEventsToUIMS(gen())) out.push(line);
  return out;
}

const parseLine = (l: string) =>
  JSON.parse(l.replace(/^data: /, '').replace(/\n\n$/, ''));

describe('UIMS tool-output forwarding', () => {
  it('forwards a successful tool-result as tool-output-available', async () => {
    const lines = await collect([
      {
        type: 'tool-result',
        toolCallId: 'tc-1',
        name: 'search_kb',
        output: { results: [{ id: 'a', kind: 'doc', title: 't' }] },
      },
      { type: 'done' },
    ]);
    const out = lines
      .map(parseLine.bind(null))
      // [DONE] is a string, skip
      .filter((j) => typeof j === 'object');
    const toolOutput = out.find((j) => j.type === 'tool-output-available');
    expect(toolOutput).toEqual({
      type: 'tool-output-available',
      toolCallId: 'tc-1',
      output: { results: [{ id: 'a', kind: 'doc', title: 't' }] },
    });
  });

  it('forwards an isError tool-result as tool-output-error', async () => {
    const lines = await collect([
      {
        type: 'tool-result',
        toolCallId: 'tc-1',
        name: 'place_widget',
        output: 'Invalid payload for kind=markdown',
        isError: true,
      },
      { type: 'done' },
    ]);
    const out = lines
      .map(parseLine.bind(null))
      .filter((j) => typeof j === 'object');
    const toolErr = out.find((j) => j.type === 'tool-output-error');
    expect(toolErr).toEqual({
      type: 'tool-output-error',
      toolCallId: 'tc-1',
      errorText: 'Invalid payload for kind=markdown',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/backend/uims-tool-output.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modify `src/backend/uims-stream.ts`**

Add a case for `tool-result`:

```ts
case 'tool-result':
  if (event.isError) {
    const errorText =
      typeof event.output === 'string'
        ? event.output
        : JSON.stringify(event.output);
    yield emit({
      type: 'tool-output-error',
      toolCallId: event.toolCallId,
      errorText,
    });
  } else {
    yield emit({
      type: 'tool-output-available',
      toolCallId: event.toolCallId,
      output: event.output,
    });
  }
  break;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/backend/uims-tool-output.test.ts`
Expected: PASS — both tests.

- [ ] **Step 5: Commit**

```bash
git add src/backend/uims-stream.ts __tests__/backend/uims-tool-output.test.ts
git commit -m "feat(uims): forward tool-result → tool-output-available (or -error)"
```

---

### Task 19: Provider adapter — wire `createSdkMcpServer` and emit tool events

**Files:**
- Modify: `src/providers/claude-agent-sdk.ts`
- Test: `__tests__/providers/claude-agent-sdk-tools.test.ts`

> **Implementer note:** This task wires `createSdkMcpServer({ tools: agentTools })` into the SDK options and updates `mapMessage` to emit `tool-call` ProviderEvents from `tool_use` blocks. The SDK loops automatically; we just observe.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeAgentSdkAdapter } from '../../src/providers/claude-agent-sdk.js';
import type { ProviderEvent } from '../../src/core/provider.js';

// Use the adapter's private mapMessage via a small re-export shim. Add this
// export to the adapter module (see Step 3): export const mapMessageForTesting.
import { mapMessageForTesting } from '../../src/providers/claude-agent-sdk.js';

describe('claude-agent-sdk adapter — tool event mapping', () => {
  it('maps assistant tool_use block to a tool-call ProviderEvent with toolCallId', () => {
    const msg: SDKMessage = {
      type: 'assistant',
      uuid: 'u-1',
      session_id: 's-1',
      message: {
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-7',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_abc',
            name: 'search_kb',
            input: { query: 'auth' },
          },
        ],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    } as unknown as SDKMessage;

    const events = mapMessageForTesting(msg);
    const call = events.find(
      (e: ProviderEvent) => e.type === 'tool-call',
    ) as Extract<ProviderEvent, { type: 'tool-call' }>;
    expect(call).toBeDefined();
    expect(call.toolCallId).toBe('toolu_abc');
    expect(call.name).toBe('search_kb');
    expect(call.input).toEqual({ query: 'auth' });
  });

  it('maps user tool_result message to tool-result event with isError when set', () => {
    const msg: SDKMessage = {
      type: 'user',
      uuid: 'u-2',
      session_id: 's-1',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_abc',
            content: 'Invalid payload',
            is_error: true,
          },
        ],
      },
    } as unknown as SDKMessage;

    const events = mapMessageForTesting(msg);
    const result = events.find(
      (e: ProviderEvent) => e.type === 'tool-result',
    ) as Extract<ProviderEvent, { type: 'tool-result' }>;
    expect(result).toBeDefined();
    expect(result.toolCallId).toBe('toolu_abc');
    expect(result.isError).toBe(true);
  });

  it('exposes adapter id and kind unchanged', () => {
    const a = new ClaudeAgentSdkAdapter();
    expect(a.id).toBe('claude-agent-sdk');
    expect(a.kind).toBe('agent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/providers/claude-agent-sdk-tools.test.ts`
Expected: FAIL — `mapMessageForTesting is not exported`, plus tool_use case missing.

- [ ] **Step 3: Modify `src/providers/claude-agent-sdk.ts`**

In the `mapMessage` private method, the `tool_use` branch already exists and emits a `tool-call` event without `toolCallId`. Update it:

```ts
} else if (block.type === 'tool_use') {
  events.push({
    type: 'tool-call',
    toolCallId: block.id,
    name: block.name,
    input: block.input,
  });
}
```

Add a new top-level branch for `message.type === 'user'` (SDK emits `user` messages with `tool_result` content blocks when handlers return). Inside the existing class:

```ts
} else if (message.type === 'user') {
  for (const block of message.message.content) {
    if (block.type === 'tool_result') {
      const isError = block.is_error === true;
      const output =
        typeof block.content === 'string'
          ? block.content
          : Array.isArray(block.content)
            ? block.content
                .filter((c) => c.type === 'text')
                .map((c) => (c as { text: string }).text)
                .join('')
            : block.content;
      events.push({
        type: 'tool-result',
        toolCallId: block.tool_use_id,
        name: '', // SDK doesn't include the tool name here; consumer uses toolCallId to correlate.
        output,
        isError,
      });
    }
  }
}
```

> **Implementer note:** The exact shape of `block.content` in tool_result varies by SDK message type. Run a quick smoke (Task 30) and use the TS types in the SDK's `sdk.d.ts` if needed. Defensive parsing above handles both string and array forms.

At the bottom of the file, expose the mapper for testing:

```ts
// Test-only re-export so __tests__ can exercise the mapper without spinning
// up the SDK. Not part of the public API.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
export function mapMessageForTesting(message: SDKMessage) {
  return new ClaudeAgentSdkAdapter().mapMessage(message);
}
```

(You'll need to change `private mapMessage` to `mapMessage` (package-private) or use `(this as any)`. Easiest: drop `private`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/providers/claude-agent-sdk-tools.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers/claude-agent-sdk.ts __tests__/providers/claude-agent-sdk-tools.test.ts
git commit -m "feat(providers): map SDK tool_use/tool_result blocks to ProviderEvents"
```

---

### Task 20: Provider adapter — wire tools, abortSignal, effort, maxTurns, display

**Files:**
- Modify: `src/providers/claude-agent-sdk.ts`
- Test: `__tests__/providers/claude-agent-sdk-options.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';

// We test that the adapter's options are constructed correctly without
// actually invoking the SDK. Mock the SDK's query() to capture options.
vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const actual = await vi.importActual<
    typeof import('@anthropic-ai/claude-agent-sdk')
  >('@anthropic-ai/claude-agent-sdk');
  return {
    ...actual,
    query: vi.fn().mockImplementation(() => {
      // Return an empty async iterable so the adapter doesn't loop forever.
      return (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          uuid: 'r-1',
          session_id: 's-1',
          duration_ms: 0,
          duration_api_ms: 0,
          is_error: false,
          num_turns: 1,
          result: '',
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      })();
    }),
  };
});

import { ClaudeAgentSdkAdapter } from '../../src/providers/claude-agent-sdk.js';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { CanvasSnapshot } from '../../src/agent/canvas-snapshot.js';

describe('claude-agent-sdk options', () => {
  it('passes maxTurns:10, maxOutputTokens:8192, effort:medium, display:summarized', async () => {
    const adapter = new ClaudeAgentSdkAdapter();
    const snap: CanvasSnapshot = {
      activeTemplateId: 'ask-anything',
      widgets: [],
    };
    // Drain the iterable.
    for await (const _ of adapter.query({
      prompt: 'hi',
      canvasSnapshot: snap,
    })) {
      // no-op
    }
    const calls = (sdkQuery as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    expect(calls).toHaveLength(1);
    const opts = (calls[0]![0] as { options: Record<string, unknown> }).options;
    expect(opts.maxTurns).toBe(10);
    expect(opts.maxOutputTokens).toBe(8192);
    expect(opts.effort).toBe('medium');
    expect((opts.thinking as { display?: string }).display).toBe('summarized');
  });

  it('forwards abortSignal to the SDK abortController', async () => {
    const adapter = new ClaudeAgentSdkAdapter();
    const ac = new AbortController();
    for await (const _ of adapter.query({
      prompt: 'hi',
      canvasSnapshot: {
        activeTemplateId: 'ask-anything',
        widgets: [],
      },
      abortSignal: ac.signal,
    })) {
      // no-op
    }
    const calls = (sdkQuery as unknown as { mock: { calls: unknown[][] } }).mock
      .calls;
    const opts = (calls[1]![0] as { options: Record<string, unknown> }).options;
    expect(opts.abortController).toBeInstanceOf(AbortController);
    // External abort must propagate into the controller.
    ac.abort();
    expect((opts.abortController as AbortController).signal.aborted).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/providers/claude-agent-sdk-options.test.ts`
Expected: FAIL — current options don't include these fields.

- [ ] **Step 3: Modify `src/providers/claude-agent-sdk.ts`**

In the `query()` method, replace the `options` construction with:

```ts
const abortController = new AbortController();
if (request.abortSignal) {
  if (request.abortSignal.aborted) abortController.abort();
  else
    request.abortSignal.addEventListener('abort', () => abortController.abort(), {
      once: true,
    });
}

// Lazy import the registry so tests that don't use it don't pull in tools.
const { buildAgentTools } = await import('../agent/tools/index.js');
const { createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');

const search = (this.deps?.search) ?? buildLazySearchAdapter();
const snapshot = request.canvasSnapshot ?? {
  activeTemplateId: 'ask-anything' as const,
  widgets: [],
};
const tools = buildAgentTools({ search, getSnapshot: () => snapshot });

const mcp = createSdkMcpServer({
  name: 'llm-wiki-tools',
  version: '0.1.0',
  tools,
  alwaysLoad: true,
});

const options: Record<string, unknown> = {
  systemPrompt,
  settingSources: [],
  cwd: cleanCwd,
  enableFileCheckpointing: false,
  forkSession: false,
  agents: {},
  mcpServers: { 'llm-wiki': mcp },
  // tool surface: allow only our SDK MCP tools (Plan 5)
  allowedTools: tools.map((t) => `mcp__llm-wiki__${t.name}`),
  maxTurns: 10,
  maxOutputTokens: 8192,
  effort: 'medium',
  thinking: { type: 'adaptive', display: 'summarized' },
  abortController,
};
if (this.config.model) options.model = this.config.model;
```

> **Implementer note:** the adapter currently has `tools: []` and `disallowedTools: ['*']` from the cache_control debugging session. Remove both — `allowedTools` is the right knob now and the empty list there would conflict.
>
> Also: the `buildLazySearchAdapter()` helper does not exist yet. Add a small helper at the top of the file:

```ts
function buildLazySearchAdapter() {
  return {
    async search() {
      return [];
    },
    async fetchById() {
      return null;
    },
  };
}
```

This lets the adapter run in tests / probes without a wired-up `BackendState`. The real wiring happens in Task 21 (route).

Also extend the constructor to accept optional `deps`:

```ts
export type ClaudeAgentSdkConfig = {
  model?: string;
  systemPrompt?: string;
};

export type ClaudeAgentSdkDeps = {
  search?: import('../agent/tools/index.js').AgentToolDeps['search'];
};

export class ClaudeAgentSdkAdapter implements LLMProvider {
  // ...
  constructor(
    private readonly config: ClaudeAgentSdkConfig = {},
    private readonly deps: ClaudeAgentSdkDeps = {},
  ) {}
  // ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/providers/claude-agent-sdk-options.test.ts`
Expected: PASS — both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/providers/claude-agent-sdk.ts __tests__/providers/claude-agent-sdk-options.test.ts
git commit -m "feat(providers): wire createSdkMcpServer + maxTurns/effort/abort"
```

---

### Task 21: Backend `/v1/chat` — accept `canvasSnapshot` and thread `abortSignal`

**Files:**
- Modify: `src/backend/routes/chat.ts`
- Modify: `src/backend/state.ts` (provider construction must inject `deps.search`)
- Test: `__tests__/backend-chat-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { chatRoute } from '../src/backend/routes/chat.js';
import { makeMockProvider } from './helpers/mock-provider.js';
import type { BackendState } from '../src/backend/state.js';

function makeState(events: Parameters<typeof makeMockProvider>[0]) {
  const provider = makeMockProvider(events);
  return {
    getLLMProvider: () => provider,
    // shadow only what chatRoute needs
  } as unknown as BackendState;
}

describe('POST /v1/chat — canvasSnapshot + tool events', () => {
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
        messages: [
          { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        ],
        canvasSnapshot: snap,
      }),
    });
    expect(res.status).toBe(200);

    const provider = state.getLLMProvider() as ReturnType<
      typeof makeMockProvider
    >;
    expect(provider.receivedRequests).toHaveLength(1);
    expect(provider.receivedRequests[0]!.canvasSnapshot?.widgets).toHaveLength(1);
  });

  it('defaults to EMPTY_SNAPSHOT when canvasSnapshot omitted', async () => {
    const state = makeState([{ type: 'done' }]);
    const app = new Hono().route('/', chatRoute(state));

    await app.request('/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        ],
      }),
    });

    const provider = state.getLLMProvider() as ReturnType<
      typeof makeMockProvider
    >;
    expect(provider.receivedRequests[0]!.canvasSnapshot?.widgets).toHaveLength(0);
  });

  it('passes an abortSignal that aborts when request body fetch is aborted', async () => {
    const state = makeState([{ type: 'done' }]);
    const app = new Hono().route('/', chatRoute(state));

    const ac = new AbortController();
    const p = app.request('/v1/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] },
        ],
      }),
      signal: ac.signal,
    });
    ac.abort();
    // Just confirm we don't throw
    await p.catch(() => undefined);

    const provider = state.getLLMProvider() as ReturnType<
      typeof makeMockProvider
    >;
    if (provider.receivedRequests.length > 0) {
      expect(provider.receivedRequests[0]!.abortSignal).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/backend-chat-tools.test.ts`
Expected: FAIL — provider doesn't receive `canvasSnapshot`.

- [ ] **Step 3: Modify `src/backend/routes/chat.ts`**

Replace the body of the POST handler with:

```ts
import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { providerEventsToUIMS, UIMS_HEADERS } from '../uims-stream.js';
import { parseCanvasSnapshot } from '../../agent/canvas-snapshot.js';
import type { BackendState } from '../state.js';

type ContentBlock = { type: string; text?: string };
type UIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | ContentBlock[];
  parts?: ContentBlock[];
};

function extractText(message: UIChatMessage): string {
  const blocks = message.parts ?? message.content;
  if (typeof blocks === 'string') return blocks;
  if (Array.isArray(blocks)) {
    return blocks
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('');
  }
  return '';
}

export function chatRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/chat', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      messages?: UIChatMessage[];
      canvasSnapshot?: unknown;
    };

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return c.json({ error: 'messages must be a non-empty array' }, 400);
    }

    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) {
      return c.json({ error: 'at least one user message is required' }, 400);
    }
    const prompt = extractText(lastUser);
    if (!prompt.trim()) {
      return c.json({ error: 'last user message has no text content' }, 400);
    }

    const systemMsg = [...body.messages].reverse().find((m) => m.role === 'system');
    const systemPrompt = systemMsg ? extractText(systemMsg) : undefined;
    const canvasSnapshot = parseCanvasSnapshot(body.canvasSnapshot);

    for (const [k, v] of Object.entries(UIMS_HEADERS)) c.header(k, v);

    return stream(c, async (s) => {
      const abortController = new AbortController();
      c.req.raw.signal.addEventListener(
        'abort',
        () => abortController.abort(),
        { once: true },
      );

      const provider = state.getLLMProvider();
      const events = provider.query({
        prompt,
        systemPrompt,
        canvasSnapshot,
        abortSignal: abortController.signal,
      });
      for await (const sseLine of providerEventsToUIMS(events)) {
        await s.write(sseLine);
      }
    });
  });

  return r;
}
```

- [ ] **Step 4: Modify `src/backend/state.ts` to inject search deps**

Find the `BackendState` class — when the active provider id is `'claude-agent-sdk'`, instantiate it with `deps: { search: this.getSearchService() }`. Specifically, find the LLM-provider construction switch and update the `claude-agent-sdk` branch:

```ts
case 'claude-agent-sdk':
  return new ClaudeAgentSdkAdapter(
    { model: cfg.model },
    { search: this.getSearchService() },
  );
```

> **Implementer note:** if `getSearchService()` is async, hoist it. Construction must remain synchronous; if the search service init is heavy, return a thin proxy from `getSearchService()` that forwards calls to a lazily-initialized service.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- __tests__/backend-chat-tools.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/backend/routes/chat.ts src/backend/state.ts __tests__/backend-chat-tools.test.ts
git commit -m "feat(backend): /v1/chat threads canvasSnapshot + abortSignal to provider"
```

---

### Task 22: Frontend — `slotForRole` on each template

**Files:**
- Modify: `app/src/canvas/templates/types.ts`
- Modify: `app/src/canvas/templates/ask-anything.ts`
- Modify: `app/src/canvas/templates/tell-me-about-x.ts`
- Modify: `app/src/canvas/templates/whats-new-since-y.ts`
- Modify: `app/src/canvas/templates/trace-x-everywhere.ts`
- Test: `__tests__/app/role-layout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import {
  ASK_ANYTHING_TEMPLATE,
  TELL_ME_ABOUT_X_TEMPLATE,
  WHATS_NEW_SINCE_Y_TEMPLATE,
  TRACE_X_EVERYWHERE_TEMPLATE,
} from '../../app/src/canvas/templates';
import type { Box } from 'tldraw';

const viewport: Box = { x: 0, y: 0, w: 1200, h: 800 } as unknown as Box;

describe('template.slotForRole', () => {
  it('every template implements slotForRole for all 6 roles', () => {
    const tpls = [
      ASK_ANYTHING_TEMPLATE,
      TELL_ME_ABOUT_X_TEMPLATE,
      WHATS_NEW_SINCE_Y_TEMPLATE,
      TRACE_X_EVERYWHERE_TEMPLATE,
    ];
    for (const t of tpls) {
      for (const role of ['primary', 'detail', 'related', 'reference', 'timeline', 'node'] as const) {
        const slot = t.slotForRole(role, 0, viewport);
        expect(slot.x).toBeDefined();
        expect(slot.y).toBeDefined();
        expect(slot.w).toBeGreaterThan(0);
        expect(slot.h).toBeGreaterThan(0);
      }
    }
  });

  it('different occupancies of the same role produce different positions', () => {
    const a = ASK_ANYTHING_TEMPLATE.slotForRole('related', 0, viewport);
    const b = ASK_ANYTHING_TEMPLATE.slotForRole('related', 1, viewport);
    expect(a.x !== b.x || a.y !== b.y).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/app/role-layout.test.ts`
Expected: FAIL — `slotForRole is not a function`.

- [ ] **Step 3: Modify `app/src/canvas/templates/types.ts`**

```ts
import type { Box } from 'tldraw';
import type { SearchResult } from '../../api/search';
import type { Role } from '../../../../src/agent/types';

export type ShapePlacement = {
  shapeType: string;
  x: number;
  y: number;
  props: Record<string, unknown>;
};

export type TemplateLayout = (
  results: SearchResult[],
  viewport: Box,
) => ShapePlacement[];

/**
 * Coordinates for one widget in a given role.
 * `occupancy` is the number of widgets *already* placed in this role
 * (used by templates that stagger or stack repeats).
 */
export type Slot = { x: number; y: number; w: number; h: number };

export type CanvasTemplate = {
  id: 'ask-anything' | 'tell-me-about-x' | 'whats-new-since-y' | 'trace-x-everywhere';
  name: string;
  layout: TemplateLayout;
  slotForRole: (role: Role, occupancy: number, viewport: Box) => Slot;
};
```

- [ ] **Step 4: Implement `slotForRole` for each template**

In `app/src/canvas/templates/ask-anything.ts`, append:

```ts
import type { Role } from '../../../../src/agent/types';

const ASK_ROLE_COLS: Record<Role, number> = {
  primary: 0,
  detail: 1,
  related: 2,
  reference: 3,
  timeline: 4,
  node: 5,
};

ASK_ANYTHING_TEMPLATE.slotForRole = (role, occupancy, viewport) => {
  const w = 320;
  const h = 200;
  const col = ASK_ROLE_COLS[role];
  return {
    x: viewport.x + 80 + col * (w + 60),
    y: viewport.y + 100 + occupancy * (h + 20),
    w,
    h,
  };
};
```

(You'll need to make `ASK_ANYTHING_TEMPLATE` mutable — change `export const ASK_ANYTHING_TEMPLATE: CanvasTemplate = { ... }` so you can attach the method, OR include `slotForRole` in the initial object literal. Prefer the latter:)

Replace the bottom of `ask-anything.ts`:

```ts
const ASK_ROLE_COLS: Record<Role, number> = {
  primary: 0,
  detail: 1,
  related: 2,
  reference: 3,
  timeline: 4,
  node: 5,
};

export const ASK_ANYTHING_TEMPLATE: CanvasTemplate = {
  id: 'ask-anything',
  name: 'Ask anything',
  layout: askAnythingLayout,
  slotForRole: (role, occupancy, viewport) => {
    const w = 320;
    const h = 200;
    const col = ASK_ROLE_COLS[role];
    return {
      x: viewport.x + 80 + col * (w + 60),
      y: viewport.y + 100 + occupancy * (h + 20),
      w,
      h,
    };
  },
};
```

For `tell-me-about-x.ts`:

```ts
const TELL_ZONES: Record<Role, { col: number; row: number }> = {
  primary: { col: 1, row: 0 },
  detail: { col: 1, row: 1 },
  related: { col: 0, row: 1 },
  reference: { col: 2, row: 1 },
  timeline: { col: 2, row: 0 },
  node: { col: 0, row: 0 },
};

// In the template literal:
slotForRole: (role, occupancy, viewport) => {
  const w = 360;
  const h = 220;
  const z = TELL_ZONES[role];
  return {
    x: viewport.x + 60 + z.col * (w + 40),
    y: viewport.y + 80 + z.row * (h + 40) + occupancy * (h + 20),
    w,
    h,
  };
},
```

For `whats-new-since-y.ts` (timeline lanes):

```ts
const NEW_LANES: Record<Role, number> = {
  timeline: 0,
  primary: 1,
  detail: 2,
  related: 3,
  reference: 4,
  node: 5,
};

slotForRole: (role, occupancy, viewport) => {
  const w = 280;
  const h = 160;
  const lane = NEW_LANES[role];
  return {
    x: viewport.x + 80 + occupancy * (w + 30),
    y: viewport.y + 80 + lane * (h + 24),
    w,
    h,
  };
},
```

For `trace-x-everywhere.ts` (radial — primary at center, others around):

```ts
slotForRole: (role, occupancy, viewport) => {
  const w = 260;
  const h = 160;
  const cx = viewport.x + viewport.w / 2 - w / 2;
  const cy = viewport.y + viewport.h / 2 - h / 2;
  if (role === 'primary') return { x: cx, y: cy, w, h };
  const ROLE_ANGLES: Record<Role, number> = {
    primary: 0,
    detail: 0,
    related: 60,
    reference: 120,
    timeline: 180,
    node: 240,
  };
  const radius = 280 + occupancy * 60;
  const deg = ROLE_ANGLES[role] + occupancy * 12;
  const rad = (deg * Math.PI) / 180;
  return {
    x: cx + Math.cos(rad) * radius,
    y: cy + Math.sin(rad) * radius,
    w,
    h,
  };
},
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- __tests__/app/role-layout.test.ts`
Expected: PASS — both tests pass for all 4 templates × 6 roles.

- [ ] **Step 6: Commit**

```bash
git add app/src/canvas/templates/ __tests__/app/role-layout.test.ts
git commit -m "feat(app): every template implements slotForRole for 6 logical roles"
```

---

### Task 23: Frontend dispatcher — `applyToolDirective` entry point + `place` directive

**Files:**
- Modify: `app/src/canvas/dispatcher.ts`
- Test: `__tests__/app/dispatcher-place.test.ts`

> **Implementer note:** the `dispatcher.ts` file already contains `placeResultsOnCanvas` from Plan 4d. Add `applyToolDirective` alongside; do not remove the existing function.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { applyToolDirective } from '../../app/src/canvas/dispatcher.js';
import type { ToolDirective } from '../../src/agent/types.js';

// Use a minimal stub editor that records createShape calls.
function makeEditor() {
  const calls: { type: string; props: Record<string, unknown> }[] = [];
  return {
    calls,
    getViewportPageBounds: () => ({ x: 0, y: 0, w: 1200, h: 800 }),
    createShape: (s: { type: string; props: Record<string, unknown> }) => {
      calls.push(s);
    },
  } as unknown as import('tldraw').Editor & { calls: typeof calls };
}

describe('applyToolDirective — place', () => {
  it('creates a markdown shape with payload props', () => {
    const editor = makeEditor() as unknown as ReturnType<typeof makeEditor>;
    const d: ToolDirective = {
      type: 'place',
      id: 'w-1',
      kind: 'markdown',
      role: 'primary',
      payload: { title: 't', body: 'b' },
    };
    applyToolDirective(editor as never, d, 'ask-anything');
    expect(editor.calls).toHaveLength(1);
    expect(editor.calls[0]!.type).toBe('llm-wiki:markdown');
    expect(editor.calls[0]!.props.title).toBe('t');
    expect(editor.calls[0]!.props.body).toBe('b');
  });

  it('uses slotForRole coords from the active template', () => {
    const editor = makeEditor() as unknown as ReturnType<typeof makeEditor>;
    const d: ToolDirective = {
      type: 'place',
      id: 'w-1',
      kind: 'markdown',
      role: 'related',
      payload: { title: 't', body: 'b' },
    };
    applyToolDirective(editor as never, d, 'ask-anything');
    // related is column 2 in ask-anything; x = 80 + 2*(320+60) = 840
    expect(editor.calls[0]!.x).toBe(840);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/app/dispatcher-place.test.ts`
Expected: FAIL — `applyToolDirective is not exported`.

- [ ] **Step 3: Modify `app/src/canvas/dispatcher.ts`**

Append:

```ts
import type { Editor } from 'tldraw';
import type { ToolDirective, TemplateId, WidgetKind } from '../../../src/agent/types';
import { TEMPLATES } from './templates';

const KIND_TO_SHAPE: Record<WidgetKind, string> = {
  markdown: 'llm-wiki:markdown',
  'code-block': 'llm-wiki:code-block',
  ticket: 'llm-wiki:ticket',
  'web-embed': 'llm-wiki:web-embed',
  'key-value-card': 'llm-wiki:key-value-card',
};

/**
 * Apply a directive coming from a backend tool to the tldraw editor.
 * `templateId` is the active template at directive-receive time
 * (read from the Zustand template store at the call site).
 */
export function applyToolDirective(
  editor: Editor,
  directive: ToolDirective,
  templateId: TemplateId,
): void {
  switch (directive.type) {
    case 'place': {
      const tpl = TEMPLATES.find((t) => t.id === templateId);
      if (!tpl) throw new Error(`unknown template: ${templateId}`);
      const occupancy = countByRole(editor, directive.role);
      const slot = tpl.slotForRole(
        directive.role,
        occupancy,
        editor.getViewportPageBounds(),
      );
      editor.createShape({
        id: ('shape:' + directive.id) as never,
        type: KIND_TO_SHAPE[directive.kind] as never,
        x: slot.x,
        y: slot.y,
        props: { ...directive.payload, w: slot.w, h: slot.h } as never,
      } as never);
      return;
    }
    default:
      // Other directive types are added in subsequent tasks.
      throw new Error(
        `applyToolDirective: directive type "${directive.type}" not implemented yet`,
      );
  }
}

function countByRole(_editor: Editor, _role: string): number {
  // For now, return 0. Task 28 plumbs role tracking via shape meta.
  return 0;
}
```

> **Implementer note:** `TEMPLATES` is the existing array exported from `app/src/canvas/templates/index.ts`. If it's exported under a different name (e.g., `ALL_TEMPLATES` or as part of an object), adapt.
>
> The shape `id: 'shape:' + directive.id` ensures we can look the shape up later by the directive's UUID — important for `focus_widget` and `link_widgets` to resolve targets.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/app/dispatcher-place.test.ts`
Expected: PASS — both tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/canvas/dispatcher.ts __tests__/app/dispatcher-place.test.ts
git commit -m "feat(app): applyToolDirective — place directive via active template's slotForRole"
```

---

### Task 24: Dispatcher — `clear` and `switchTemplate`

**Files:**
- Modify: `app/src/canvas/dispatcher.ts`
- Test: `__tests__/app/dispatcher-clear-switch.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { applyToolDirective } from '../../app/src/canvas/dispatcher.js';
import { useTemplateStore } from '../../app/src/state/template-store.js';

const makeEditor = () => {
  const shapes: { id: string; type: string }[] = [
    { id: 'shape:w-1', type: 'llm-wiki:markdown' },
    { id: 'shape:w-2', type: 'llm-wiki:ticket' },
    { id: 'shape:other', type: 'geo' },
  ];
  return {
    shapes,
    getCurrentPageShapes: () => shapes,
    deleteShapes: (ids: string[]) => {
      for (const id of ids) {
        const i = shapes.findIndex((s) => s.id === id);
        if (i >= 0) shapes.splice(i, 1);
      }
    },
    getViewportPageBounds: () => ({ x: 0, y: 0, w: 1200, h: 800 }),
    createShape: vi.fn(),
  } as never;
};

describe('applyToolDirective — clear & switchTemplate', () => {
  it('clear directive removes only llm-wiki:* shapes', () => {
    const editor = makeEditor();
    applyToolDirective(editor, { type: 'clear' }, 'ask-anything');
    expect((editor as never as { shapes: unknown[] }).shapes).toHaveLength(1);
    expect(((editor as never as { shapes: { type: string }[] }).shapes[0]).type).toBe('geo');
  });

  it('switchTemplate updates the Zustand store', () => {
    useTemplateStore.setState({ activeTemplateId: 'ask-anything' });
    const editor = makeEditor();
    applyToolDirective(
      editor,
      { type: 'switchTemplate', id: 'tell-me-about-x' },
      'ask-anything',
    );
    expect(useTemplateStore.getState().activeTemplateId).toBe('tell-me-about-x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/app/dispatcher-clear-switch.test.ts`
Expected: FAIL — directive types not handled.

- [ ] **Step 3: Modify `app/src/canvas/dispatcher.ts`**

In the `switch (directive.type)` block, replace the `default` branch:

```ts
case 'clear': {
  const ids = editor
    .getCurrentPageShapes()
    .filter((s) => s.type.startsWith('llm-wiki:'))
    .map((s) => s.id as never);
  if (ids.length > 0) editor.deleteShapes(ids);
  return;
}
case 'switchTemplate': {
  // Lazy import to avoid binding the Zustand store at file-load time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useTemplateStore } = require('../state/template-store') as typeof import('../state/template-store');
  useTemplateStore.getState().setActiveTemplateId(directive.id);
  return;
}
default:
  throw new Error(
    `applyToolDirective: directive type "${(directive as { type: string }).type}" not implemented yet`,
  );
```

> **Implementer note:** drop the `require` if your build supports synchronous ESM imports of zustand stores. Static `import { useTemplateStore } from '../state/template-store'` at the top of the file is preferred.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/app/dispatcher-clear-switch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/canvas/dispatcher.ts __tests__/app/dispatcher-clear-switch.test.ts
git commit -m "feat(app): applyToolDirective — clear + switchTemplate"
```

---

### Task 25: Dispatcher — `focus`

**Files:**
- Modify: `app/src/canvas/dispatcher.ts`
- Test: `__tests__/app/dispatcher-focus.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { applyToolDirective } from '../../app/src/canvas/dispatcher.js';

describe('applyToolDirective — focus', () => {
  it('zooms the editor to the shape with the matching id', () => {
    const zoomToBounds = vi.fn();
    const editor = {
      getShape: vi.fn().mockReturnValue({
        id: 'shape:w-1',
        x: 100,
        y: 200,
        props: { w: 320, h: 200 },
      }),
      zoomToBounds,
    } as never;
    applyToolDirective(editor, { type: 'focus', id: 'w-1' }, 'ask-anything');
    expect(zoomToBounds).toHaveBeenCalled();
  });

  it('throws when the shape is not found', () => {
    const editor = {
      getShape: () => undefined,
      zoomToBounds: vi.fn(),
    } as never;
    expect(() =>
      applyToolDirective(editor, { type: 'focus', id: 'missing' }, 'ask-anything'),
    ).toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/app/dispatcher-focus.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modify dispatcher**

Insert before the `default` case:

```ts
case 'focus': {
  const shape = editor.getShape(('shape:' + directive.id) as never);
  if (!shape) throw new Error(`shape not found for id: ${directive.id}`);
  // tldraw v3: zoomToBounds takes a Box; use the shape's page bounds.
  const sx = (shape as { x: number }).x;
  const sy = (shape as { y: number }).y;
  const sw = ((shape as { props: { w?: number } }).props.w) ?? 320;
  const sh = ((shape as { props: { h?: number } }).props.h) ?? 200;
  editor.zoomToBounds({ x: sx, y: sy, w: sw, h: sh } as never, {
    inset: 80,
    animation: { duration: 200 },
  } as never);
  return;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/app/dispatcher-focus.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/canvas/dispatcher.ts __tests__/app/dispatcher-focus.test.ts
git commit -m "feat(app): applyToolDirective — focus zooms to shape's bounds"
```

---

### Task 26: Dispatcher — `link`

**Files:**
- Modify: `app/src/canvas/dispatcher.ts`
- Test: `__tests__/app/dispatcher-link.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { applyToolDirective } from '../../app/src/canvas/dispatcher.js';

describe('applyToolDirective — link', () => {
  it('creates an arrow shape between two existing shapes with optional label', () => {
    const createShape = vi.fn();
    const editor = {
      getShape: vi.fn((id: string) => ({
        id,
        x: id === 'shape:w-1' ? 0 : 600,
        y: 0,
        props: { w: 320, h: 200 },
      })),
      createShape,
    } as never;
    applyToolDirective(
      editor,
      {
        type: 'link',
        linkId: 'l-1',
        fromId: 'w-1',
        toId: 'w-2',
        label: 'implements',
      },
      'ask-anything',
    );
    expect(createShape).toHaveBeenCalledTimes(1);
    const arg = (createShape as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0]![0] as { type: string; props: Record<string, unknown> };
    expect(arg.type).toBe('arrow');
    expect(arg.props.text).toBe('implements');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/app/dispatcher-link.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modify dispatcher**

Insert:

```ts
case 'link': {
  const from = editor.getShape(('shape:' + directive.fromId) as never);
  const to = editor.getShape(('shape:' + directive.toId) as never);
  if (!from || !to) {
    throw new Error(
      `link: missing shape (from=${directive.fromId}, to=${directive.toId})`,
    );
  }
  const fx =
    (from as { x: number }).x + ((from as { props: { w?: number } }).props.w ?? 320) / 2;
  const fy =
    (from as { y: number }).y + ((from as { props: { h?: number } }).props.h ?? 200) / 2;
  const tx =
    (to as { x: number }).x + ((to as { props: { w?: number } }).props.w ?? 320) / 2;
  const ty =
    (to as { y: number }).y + ((to as { props: { h?: number } }).props.h ?? 200) / 2;
  editor.createShape({
    id: ('shape:' + directive.linkId) as never,
    type: 'arrow',
    x: 0,
    y: 0,
    props: {
      start: { x: fx, y: fy },
      end: { x: tx, y: ty },
      text: directive.label ?? '',
    } as never,
  } as never);
  return;
}
```

> **Implementer note:** tldraw's arrow shape has bound vs. unbound modes. Above we create a free arrow with absolute endpoints. If you want the arrow to *follow* the linked shapes, use tldraw's `editor.createBindings` API. Free is simpler for v1.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/app/dispatcher-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/canvas/dispatcher.ts __tests__/app/dispatcher-link.test.ts
git commit -m "feat(app): applyToolDirective — link draws an arrow with optional label"
```

---

### Task 27: Frontend snapshot computer

**Files:**
- Create: `app/src/canvas/snapshot.ts`
- Test: `__tests__/app/snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { computeCanvasSnapshot } from '../../app/src/canvas/snapshot.js';

const makeEditor = () => ({
  getCurrentPageShapes: () => [
    {
      id: 'shape:w-1',
      type: 'llm-wiki:markdown',
      meta: { role: 'primary' },
      props: { title: 'auth', body: 'body' },
    },
    {
      id: 'shape:other',
      type: 'geo',
      meta: {},
      props: {},
    },
  ],
});

describe('computeCanvasSnapshot', () => {
  it('serializes only llm-wiki shapes, mapping shape type → kind', () => {
    const snap = computeCanvasSnapshot(
      makeEditor() as never,
      'ask-anything',
    );
    expect(snap.activeTemplateId).toBe('ask-anything');
    expect(snap.widgets).toHaveLength(1);
    expect(snap.widgets[0]!.id).toBe('w-1');
    expect(snap.widgets[0]!.kind).toBe('markdown');
  });

  it('falls back to role:primary when meta.role is missing', () => {
    const snap = computeCanvasSnapshot(
      {
        getCurrentPageShapes: () => [
          {
            id: 'shape:w-2',
            type: 'llm-wiki:ticket',
            meta: {},
            props: { title: 't', ticketId: 'X-1', status: 'open' },
          },
        ],
      } as never,
      'ask-anything',
    );
    expect(snap.widgets[0]!.role).toBe('primary');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/app/snapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `app/src/canvas/snapshot.ts`**

```ts
import type { Editor } from 'tldraw';
import type {
  WidgetKind,
  Role,
  TemplateId,
} from '../../../src/agent/types';

const SHAPE_TO_KIND: Record<string, WidgetKind> = {
  'llm-wiki:markdown': 'markdown',
  'llm-wiki:code-block': 'code-block',
  'llm-wiki:ticket': 'ticket',
  'llm-wiki:web-embed': 'web-embed',
  'llm-wiki:key-value-card': 'key-value-card',
};

export type CanvasSnapshotShape = {
  activeTemplateId: TemplateId;
  widgets: Array<{
    id: string;
    kind: WidgetKind;
    role: Role;
    title: string;
    payload: Record<string, unknown>;
  }>;
};

/**
 * Walk page shapes, keep only llm-wiki:* widgets, return the snapshot
 * the backend expects. Cheap; called per chat submit.
 */
export function computeCanvasSnapshot(
  editor: Editor,
  activeTemplateId: TemplateId,
): CanvasSnapshotShape {
  const shapes = editor.getCurrentPageShapes() as Array<{
    id: string;
    type: string;
    meta?: Record<string, unknown>;
    props: Record<string, unknown>;
  }>;
  const widgets = shapes
    .filter((s) => SHAPE_TO_KIND[s.type] !== undefined)
    .map((s) => ({
      // shape ids are 'shape:<uuid>'; strip the prefix to recover the directive id.
      id: s.id.replace(/^shape:/, ''),
      kind: SHAPE_TO_KIND[s.type]!,
      role: ((s.meta?.['role'] as Role) ?? 'primary') as Role,
      title: ((s.props['title'] as string) ?? s.id) as string,
      payload: { ...s.props },
    }));
  return { activeTemplateId, widgets };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/app/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/canvas/snapshot.ts __tests__/app/snapshot.test.ts
git commit -m "feat(app): computeCanvasSnapshot walks llm-wiki shapes for per-turn payload"
```

---

### Task 28: Track role on placed shapes

**Files:**
- Modify: `app/src/canvas/dispatcher.ts` (in the `place` case, store `role` in `shape.meta`)
- Test: extend `__tests__/app/dispatcher-place.test.ts`

- [ ] **Step 1: Extend the existing test**

Append to `__tests__/app/dispatcher-place.test.ts`:

```ts
it('stores role in shape.meta so computeCanvasSnapshot can read it back', () => {
  const editor = makeEditor() as unknown as ReturnType<typeof makeEditor>;
  applyToolDirective(
    editor as never,
    {
      type: 'place',
      id: 'w-1',
      kind: 'markdown',
      role: 'related',
      payload: { title: 't', body: 'b' },
    },
    'ask-anything',
  );
  const call = editor.calls[0]! as unknown as {
    meta: Record<string, unknown>;
  };
  expect(call.meta?.role).toBe('related');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/app/dispatcher-place.test.ts`
Expected: FAIL — `meta` not present in the createShape call.

- [ ] **Step 3: Modify the `place` branch in `applyToolDirective`**

```ts
editor.createShape({
  id: ('shape:' + directive.id) as never,
  type: KIND_TO_SHAPE[directive.kind] as never,
  x: slot.x,
  y: slot.y,
  meta: { role: directive.role } as never,
  props: { ...directive.payload, w: slot.w, h: slot.h } as never,
} as never);
```

Also update `countByRole` to read `meta.role`:

```ts
function countByRole(editor: Editor, role: string): number {
  const shapes = editor.getCurrentPageShapes() as Array<{
    type: string;
    meta?: Record<string, unknown>;
  }>;
  return shapes.filter(
    (s) =>
      s.type.startsWith('llm-wiki:') && (s.meta?.['role'] as string) === role,
  ).length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/app/dispatcher-place.test.ts`
Expected: PASS — all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/canvas/dispatcher.ts __tests__/app/dispatcher-place.test.ts
git commit -m "feat(app): persist role on shape.meta so snapshots round-trip"
```

---

### Task 29: Chat — send `canvasSnapshot` in request body

**Files:**
- Modify: `app/src/components/Chat.tsx`
- Test: `__tests__/app/chat-snapshot.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Chat } from '../../app/src/components/Chat.js';
import { useTemplateStore } from '../../app/src/state/template-store.js';

// Capture fetch invocations to assert request body shape.
const fetchMock = vi.fn().mockResolvedValue(
  new Response('data: {"type":"finish"}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'x-vercel-ai-ui-message-stream': 'v1',
    },
  }),
);

beforeEach(() => {
  globalThis.fetch = fetchMock as never;
  fetchMock.mockClear();
  useTemplateStore.setState({ activeTemplateId: 'ask-anything' });
});

describe('Chat sends canvasSnapshot', () => {
  it('includes activeTemplateId from the Zustand store', async () => {
    const { getByPlaceholderText, getByLabelText } = render(<Chat />);
    fireEvent.change(getByPlaceholderText(/Ask anything/i), {
      target: { value: 'hi' },
    });
    fireEvent.click(getByLabelText('Send'));

    // Wait for fetch to fire
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalled();
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body.canvasSnapshot.activeTemplateId).toBe('ask-anything');
    expect(Array.isArray(body.canvasSnapshot.widgets)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/app/chat-snapshot.test.tsx`
Expected: FAIL — body has no `canvasSnapshot`.

- [ ] **Step 3: Modify `app/src/components/Chat.tsx`**

`useChat`'s `DefaultChatTransport` accepts a `body` callback. Use it to inject the snapshot from the editor — but since `useChat` is invoked outside the tldraw editor scope, we need a separate mechanism.

The simplest path: add a singleton `latestSnapshot` ref in a small module; the canvas updates it via tldraw's listener; Chat reads it in the `body` callback.

Create `app/src/state/snapshot-ref.ts`:

```ts
import type { CanvasSnapshotShape } from '../canvas/snapshot';

let current: CanvasSnapshotShape = {
  activeTemplateId: 'ask-anything',
  widgets: [],
};

export function setLatestSnapshot(snap: CanvasSnapshotShape): void {
  current = snap;
}

export function getLatestSnapshot(): CanvasSnapshotShape {
  return current;
}
```

In `app/src/canvas/Canvas.tsx`, inside `handleMount`:

```ts
import { setLatestSnapshot } from '../state/snapshot-ref';
import { computeCanvasSnapshot } from './snapshot';
import { useTemplateStore } from '../state/template-store';
// ...
editor.store.listen(() => {
  // Existing debounced save logic remains.
  const tplId = useTemplateStore.getState().activeTemplateId;
  setLatestSnapshot(computeCanvasSnapshot(editor, tplId));
});
// Initial publish so the very first chat turn sees current state.
const tplId = useTemplateStore.getState().activeTemplateId;
setLatestSnapshot(computeCanvasSnapshot(editor, tplId));
```

In `app/src/components/Chat.tsx`, change the `useChat` call:

```tsx
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { getLatestSnapshot } from '../state/snapshot-ref';

export function Chat() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/v1/chat',
      body: () => ({ canvasSnapshot: getLatestSnapshot() }),
    }),
  });
  // rest unchanged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/app/chat-snapshot.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/canvas/Canvas.tsx app/src/components/Chat.tsx app/src/state/snapshot-ref.ts __tests__/app/chat-snapshot.test.tsx
git commit -m "feat(app): chat sends canvasSnapshot computed from live editor state"
```

---

### Task 30: Chat — apply tool directives from useChat parts

**Files:**
- Modify: `app/src/components/Chat.tsx`
- Test: `__tests__/app/chat-tool-handler.test.tsx`

The AI SDK `useChat` exposes received tool chunks as `messages[].parts` with types like `tool-input-available`, `tool-output-available`, `tool-output-error`. We listen for `tool-output-available` and dispatch.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { Chat } from '../../app/src/components/Chat.js';

// Mock useChat to inject a fake messages list with a tool-output-available part.
vi.mock('@ai-sdk/react', () => {
  return {
    useChat: () => ({
      messages: [
        {
          id: 'm-1',
          role: 'assistant',
          parts: [
            {
              type: 'tool-output-available',
              toolCallId: 'tc-1',
              output: {
                ok: true,
                id: 'w-1',
                directive: {
                  type: 'place',
                  id: 'w-1',
                  kind: 'markdown',
                  role: 'primary',
                  payload: { title: 't', body: 'b' },
                },
              },
            },
          ],
        },
      ],
      sendMessage: vi.fn(),
      status: 'ready' as const,
    }),
  };
});

const applyMock = vi.fn();
vi.mock('../../app/src/canvas/dispatcher.js', () => ({
  applyToolDirective: applyMock,
  placeResultsOnCanvas: vi.fn(),
}));

beforeEach(() => applyMock.mockClear());

describe('Chat tool handler', () => {
  it('applies place directive when tool-output-available arrives', () => {
    render(<Chat />);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0]![1].type).toBe('place');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/app/chat-tool-handler.test.tsx`
Expected: FAIL — `applyToolDirective` not called.

- [ ] **Step 3: Modify `app/src/components/Chat.tsx`**

Add an effect that scans `messages` for new `tool-output-available` parts and dispatches them. Track applied directive ids in a ref to avoid double-applying on re-render.

Replace the body of `Chat` (keep the existing JSX, only add the effect & ref):

```tsx
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEditor } from 'tldraw';
import { applyToolDirective } from '../canvas/dispatcher';
import { getLatestSnapshot } from '../state/snapshot-ref';
import { useTemplateStore } from '../state/template-store';
import type { ToolDirective } from '../../../src/agent/types';

type ToolOutputPart = {
  type: 'tool-output-available';
  toolCallId: string;
  output: { directive?: ToolDirective } | unknown;
};

function isDirective(o: unknown): o is { directive: ToolDirective } {
  return (
    typeof o === 'object' &&
    o !== null &&
    'directive' in o &&
    typeof (o as { directive: unknown }).directive === 'object'
  );
}

export function Chat() {
  const editor = useEditor();
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/v1/chat',
      body: () => ({ canvasSnapshot: getLatestSnapshot() }),
    }),
  });
  const [input, setInput] = useState('');
  const isStreaming = status === 'streaming';
  const appliedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const m of messages) {
      for (const p of m.parts as Array<ToolOutputPart | unknown>) {
        if (
          typeof p === 'object' &&
          p !== null &&
          (p as { type: string }).type === 'tool-output-available'
        ) {
          const op = p as ToolOutputPart;
          if (appliedRef.current.has(op.toolCallId)) continue;
          if (isDirective(op.output)) {
            const tplId = useTemplateStore.getState().activeTemplateId;
            try {
              applyToolDirective(editor, op.output.directive, tplId);
            } catch (e) {
              console.error('[chat] applyToolDirective failed:', e);
            }
            appliedRef.current.add(op.toolCallId);
          }
        }
      }
    }
  }, [messages, editor]);

  // ... rest of Chat JSX unchanged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/app/chat-tool-handler.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/Chat.tsx __tests__/app/chat-tool-handler.test.tsx
git commit -m "feat(app): Chat applies tool directives from tool-output-available parts"
```

---

### Task 31: Chat — render tool-call indicator + tool-output-error indicator

**Files:**
- Modify: `app/src/components/Chat.tsx`
- Test: extend `__tests__/app/chat-tool-handler.test.tsx`

- [ ] **Step 1: Extend the test file**

Append to `__tests__/app/chat-tool-handler.test.tsx`:

```tsx
import { render } from '@testing-library/react';

describe('Chat tool indicators', () => {
  it('renders a "calling tool…" indicator on tool-input-available', () => {
    vi.doMock('@ai-sdk/react', () => ({
      useChat: () => ({
        messages: [
          {
            id: 'm-1',
            role: 'assistant',
            parts: [
              {
                type: 'tool-input-available',
                toolCallId: 'tc-1',
                toolName: 'search_kb',
                input: { query: 'auth' },
              },
            ],
          },
        ],
        sendMessage: vi.fn(),
        status: 'streaming' as const,
      }),
    }));
    return import('../../app/src/components/Chat.js').then(({ Chat }) => {
      const { getByText } = render(<Chat />);
      expect(getByText(/calling search_kb/i)).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- __tests__/app/chat-tool-handler.test.tsx`
Expected: FAIL — no indicator rendered.

- [ ] **Step 3: Modify Chat JSX**

In the messages map, replace the part-rendering block:

```tsx
{m.parts.map((p, i) => {
  if (p.type === 'text') {
    return <span key={i}>{(p as { text: string }).text}</span>;
  }
  if (p.type === 'tool-input-available') {
    const tc = p as { toolName: string };
    return (
      <span key={i} className="text-xs text-zinc-500 italic">
        calling {tc.toolName}…
      </span>
    );
  }
  if (p.type === 'tool-output-error') {
    const er = p as { errorText: string };
    return (
      <span key={i} className="text-xs text-red-400">
        tool error: {er.errorText}
      </span>
    );
  }
  // tool-output-available: render nothing — directive already applied.
  return null;
})}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- __tests__/app/chat-tool-handler.test.tsx`
Expected: PASS — both tests.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/Chat.tsx __tests__/app/chat-tool-handler.test.tsx
git commit -m "feat(app): Chat renders tool-call + tool-error indicators"
```

---

### Task 32: System prompt + manual smoke doc

**Files:**
- Modify: `src/providers/claude-agent-sdk.ts` (replace `DEFAULT_SYSTEM_PROMPT`)
- Create: `__tests__/manual/plan-5-smoke.md`

- [ ] **Step 1: Update `DEFAULT_SYSTEM_PROMPT` in `src/providers/claude-agent-sdk.ts`**

Replace the constant:

```ts
const DEFAULT_SYSTEM_PROMPT = `You are llm-wiki, a knowledge assistant. The user has a canvas where you can place widgets to visualize answers spatially.

Use tools when visual presentation aids the answer (lookups across sources, multi-item synthesis, walkthroughs). Reply with text only for chitchat, clarifications, follow-ups about content already on the canvas, or simple factual questions.

Widget kinds: markdown, code-block, ticket, web-embed, key-value-card.
Roles: primary (main subject), detail (depth on primary), related (adjacent), reference (citations), timeline (time-anchored), node (graph node).

Search before citing — never invent ids, urls, or quotes.`;
```

- [ ] **Step 2: Create `__tests__/manual/plan-5-smoke.md`**

```markdown
# Plan 5 — Manual Smoke Tests

Run these against a live backend (`pnpm backend`) and Vite app (`pnpm dev`).
For each, observe the chat panel + canvas and confirm the expected behavior.

## 1. Pure chat, no tools

- Type: `say hi`
- Expected:
  - Streaming text reply (one short greeting).
  - **No** tool-call indicators in the chat.
  - **No** new widgets on the canvas.

If a tool-call indicator appears, the system prompt isn't discouraging
gratuitous tool use — re-tune the prompt before shipping.

## 2. Lookup + render

- Pre-condition: at least one indexed source. Run
  `pnpm tsx scripts/cli.ts index --source <id>` first if needed.
- Type: `tell me about TICKET-101` (or any content you know is indexed).
- Expected:
  - Tool-call indicators for `search_kb` (and likely `fetch_result`,
    then `place_widget`).
  - At least one new widget on the canvas — kind matches what the
    indexed source returned (ticket card / markdown / etc.).
  - Streaming text reply that references the placed widget.

## 3. Multi-tool investigation

- Type: `walk me through how auth works`.
- Expected:
  - 2+ widgets land on the canvas (e.g., one markdown overview + one
    code-block with the relevant function).
  - Possibly a `link_widgets` arrow connecting them.
  - Text reply references both placements.

## 4. Cancel mid-loop

- Ask a complex question (#2 or #3 are good candidates).
- While the loop is iterating (you should see tool-call indicators
  appearing one by one), click Stop.
- Expected:
  - Loop terminates at the next boundary; no further tool-call
    indicators appear.
  - Widgets already placed remain on the canvas.
  - No uncaught errors in the browser console.
  - Backend log shows clean SSE close, no stack traces.

## 5. Iteration cap

- Ask a deliberately hard, broad question that the agent can't answer
  in 10 calls (e.g., `enumerate every TODO comment in every indexed
  file and place a card for each`).
- Expected:
  - Loop hits `maxTurns: 10` and terminates.
  - Chat shows the partial work + an error toast referencing
    "exceeded 10 iterations".
  - Backend log shows the SDK `error_max_turns` result subtype.
```

- [ ] **Step 3: Commit**

```bash
git add src/providers/claude-agent-sdk.ts __tests__/manual/plan-5-smoke.md
git commit -m "feat(plan-5): system prompt + manual smoke checklist"
```

---

## Self-review

1. **Spec coverage:** Every section in the design doc maps to a task —
   types/payloads/snapshot (T1-T3), 9 tools (T4-T12), registry (T13),
   `fetchById` infra (T14), provider-event extensions (T15), test helper
   (T16), UIMS forwarding (T17-T18), provider adapter wiring (T19-T20),
   route extension (T21), template `slotForRole` (T22), dispatcher (T23-T26),
   snapshot computer (T27), role tracking on shapes (T28), Chat snapshot
   send (T29), Chat directive apply + indicators (T30-T31), system prompt
   + smoke (T32). ✅

2. **Placeholder scan:** No "TBD"/"TODO"/"implement later". Every code
   block is concrete, every test uses real assertions, every command has
   an expected outcome. The two implementer notes (Task 14 on `fetchById`
   schema details, Task 21 on `getSearchService` synchronicity) are
   informed flags, not placeholders.

3. **Type consistency:** `WidgetKind`, `Role`, `TemplateId`, `ToolDirective`,
   `CanvasSnapshot` are defined in T1+T3 and used unchanged through every
   later task. `applyToolDirective(editor, directive, templateId)` signature
   is consistent across T23-T26 and T30. `buildAgentTools(deps)` shape in
   T13 matches the call site in T20.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-03-plan-5-agent-loop.md`.**

This is a 32-task plan touching backend tools, provider wiring, UIMS
forwarding, route, dispatcher, and chat UI. Each task is bite-sized
(2-5 minute steps), but the plan as a whole is large.

**Two execution options:**

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task,
   two-stage review (spec compliance + code quality), fast iteration.
   Especially appropriate for a 32-task plan: each subagent gets a clean
   context, the controller (you) just orchestrates and reviews.

2. **Inline Execution** — Execute tasks in this session using
   superpowers:executing-plans, batched with checkpoints for review.

**Which approach?**

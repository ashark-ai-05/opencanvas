# Plan 5 — Agent Loop with Tool-Calling Design

**Status:** approved (brainstorm), pending implementation plan
**Date:** 2026-05-03
**Owner:** llm-wiki

## Goal

Turn the chat path into the canvas driver. After this plan, asking a question
in chat causes the LLM to autonomously call tools that search the knowledge
base, place widgets on the tldraw canvas, link them, and switch layout
templates — all streaming in real time alongside its text reply. This closes
the "agent reshapes the interface" loop that has been the product thesis since
the design spec.

## Why this is needed

The chat (`/v1/chat`) and the canvas (`SearchBar` → `placeResultsOnCanvas`)
are wired separately today. Typing in chat produces only text; widgets only
land when a user types in the SearchBar. The LLM has no awareness that a
canvas exists and no capability to mutate it. Plan 5 dissolves that boundary
by exposing canvas operations as tools to the Claude Agent SDK and letting
the SDK's agent loop drive them.

## Decisions summary

The brainstorm settled six questions:

| # | Question | Decision |
|---|----------|----------|
| 1 | Tool surface scope | **C — full** (~10 tools), trimmed during design audit to **9** |
| 2 | Widget placement strategy | **B — logical role + active template** (model picks `role`, browser computes coords) |
| 3 | Chat-vs-canvas policy | **B — agent decides** (system prompt instructs use only when visual helps) — *plus* explicit token-optimization constraint |
| 4 | Search strategy | **A — tool only** (no pre-fetch; agent calls `search_kb` when it judges it needs to) |
| 5 | Loop bounds + cancel | iter cap **10**, **boundary cancel**, output cap **8K tokens** |
| 6 | `read_canvas` semantics | **B — skim + drill** (`read_canvas` summary, `read_widget` for depth) |

Architecture choice: **Approach 1 — backend handlers as directive emitters;
browser is canvas source of truth.** Approaches 2 (browser-hosted MCP) and 3
(backend canvas mirror) ruled out as over-engineered for the problem at hand.

## 1. Architecture

```
┌──────────────────────── browser (Vite app, :3458) ────────────────────────┐
│                                                                            │
│   Chat component  ──┐         tldraw editor + Zustand template store      │
│   (useChat)         │         (the canvas — source of truth)              │
│                     │                          ▲                          │
│                     ▼                          │ apply directive          │
│   POST /v1/chat                                │ via                      │
│   { messages,                                  │ canvasDispatcher.ts      │
│     canvasSnapshot ◄── computed from editor ─┐ │                          │
│   }                                          │ │                          │
│                                              │ │                          │
└──────────────────────────┬───────────────────┘─┘──────────────────────────┘
                           │ SSE (UIMS)         ▲
                           ▼                    │
┌─────────────────── backend (Hono, :3457) ────┴───────────────────────────┐
│                                                                            │
│   /v1/chat route                                                           │
│     ├─ extracts {prompt, systemPrompt, canvasSnapshot}                     │
│     └─ ClaudeAgentSdkAdapter.query({ ..., canvasSnapshot, abortSignal })   │
│           │                                                                │
│           ▼                                                                │
│     Claude Agent SDK (with createSdkMcpServer({tools: agentTools}))        │
│           │  loops:  model → tool_use → handler → tool_result → model      │
│           │                                                                │
│           ▼                                                                │
│     ProviderEvent stream:                                                  │
│       text-delta | thinking-delta | tool-call | tool-result | done | error │
│           │                                                                │
│           ▼                                                                │
│     providerEventsToUIMS  →  SSE chunks                                    │
│           │                                                                │
└───────────┴────────────────────────────────────────────────────────────────┘
```

**Components.** Five new files, four extended:

| File | Status | Responsibility |
|------|--------|----------------|
| `src/agent/tools/index.ts` | new | Registers all 9 tools as `SdkMcpToolDefinition[]`, exports for adapter |
| `src/agent/tools/{search-kb,fetch-result,read-canvas,read-widget,place-widget,switch-template,clear-canvas,focus-widget,link-widgets}.ts` | new (one file per tool) | Zod schema + handler. Pure function; no class state. |
| `src/agent/payloads.ts` | new | Per-`WidgetKind` Zod payload schemas (shared between tool validation and browser dispatcher) |
| `src/agent/canvas-snapshot.ts` | new | Type def for `CanvasSnapshot` (the per-turn state passed in request body) |
| `src/agent/types.ts` | new | `WidgetKind`, `Role`, `TemplateId` enums |
| `src/providers/claude-agent-sdk.ts` | extended | Wires tools via `createSdkMcpServer`; emits `tool-call`/`tool-result` ProviderEvents; threads `abortSignal` into SDK's `abortController`; sets `effort: 'medium'`, `maxTurns: 10`, `maxOutputTokens: 8192`, `display: 'summarized'` |
| `src/backend/uims-stream.ts` | extended | Forwards `tool-call`/`tool-result` ProviderEvents as UIMS `tool-input-available` / `tool-output-available` chunks (and `tool-output-error` on `isError`) |
| `src/backend/routes/chat.ts` | extended | Accepts `canvasSnapshot` in request body; forwards request abort to provider |
| `src/core/provider.ts` | extended | `QueryRequest` gains optional `canvasSnapshot` and `abortSignal` |
| `app/src/canvas/dispatcher.ts` | extended | New entry point: `applyToolDirective(editor, directive)` switches on directive type and applies via tldraw editor + Zustand store |
| `app/src/components/Chat.tsx` | extended | Subscribes to `messages[].parts` of type `tool-*`; calls dispatcher when `tool-output-available` arrives with a directive |

**Boundaries (the load-bearing structure).**

- **Tool handlers know nothing about the canvas.** They validate input and
  return structured directives. Canvas-affecting handlers do not call any
  browser API — they cannot, since they run in Node. This keeps each handler
  testable as a pure function.
- **Browser dispatcher knows nothing about the model.** It receives a typed
  directive and applies it to the editor. Same shape regardless of source —
  could be a tool call or a manual SearchBar dispatch.
- **The canvas snapshot is request-scoped.** Backend holds it for the duration
  of one `provider.query()` call; never persists it.

## 2. Tool surface

Two enums shared across tools (defined in `src/agent/types.ts`):

```ts
type WidgetKind =
  | 'markdown' | 'code-block' | 'ticket' | 'web-embed' | 'key-value-card';

type Role =
  | 'primary'    // main subject of the answer
  | 'detail'     // supplementary detail of primary
  | 'related'    // adjacent items
  | 'reference'  // citations / source material
  | 'timeline'   // time-anchored item
  | 'node';      // generic graph node

type TemplateId =
  | 'ask-anything' | 'tell-me-about-x'
  | 'whats-new-since-y' | 'trace-x-everywhere';
```

Per-kind payload schemas (defined in `src/agent/payloads.ts`, used by both
the `place_widget` handler's validation and the browser dispatcher's
narrowing):

```ts
const MarkdownPayload     = z.object({ title: z.string(), body: z.string() });
const CodeBlockPayload    = z.object({ title: z.string(), language: z.string(),
                                       code: z.string(),
                                       source: z.string().optional() });
const TicketPayload       = z.object({ ticketId: z.string(), title: z.string(),
                                       status: z.string(),
                                       assignee: z.string().optional(),
                                       priority: z.string().optional() });
const WebEmbedPayload     = z.object({ title: z.string(), url: z.string().url(),
                                       snippet: z.string().optional() });
const KeyValueCardPayload = z.object({
  title: z.string(),
  fields: z.array(z.object({ key: z.string(), value: z.string() })),
});
```

The 9 tools:

| # | Tool | Input | Output | Description (what model sees) |
|---|------|-------|--------|-------------------------------|
| 1 | `search_kb` | `{ query: string, limit?: number ≤ 25 }` (default 10) | `{ results: Array<{ id, kind, title, snippet, score, source }> }` | "Search indexed knowledge (code, docs, tickets). Returns summary results." |
| 2 | `fetch_result` | `{ id: string }` | `{ result: { id, kind, title, payload, source } }` | "Fetch the full payload of a search result by id." |
| 3 | `place_widget` | `{ kind: WidgetKind, role: Role, payload: object }` (payload schema discriminated by kind) | `{ ok: true, id: string }` | "Place a widget on the canvas at `role`'s slot." |
| 4 | `read_canvas` | `{}` | `{ widgets: Array<{ id, kind, role, title }> }` | "List widgets currently on the canvas (summary only)." |
| 5 | `read_widget` | `{ id: string }` | `{ widget: { id, kind, role, payload } }` | "Read the full payload of one canvas widget." |
| 6 | `focus_widget` | `{ id: string }` | `{ ok: true }` | "Pan and zoom the canvas to a specific widget." |
| 7 | `link_widgets` | `{ fromId: string, toId: string, label?: string }` | `{ ok: true, linkId: string }` | "Draw a labeled visual edge between two widgets." |
| 8 | `clear_canvas` | `{}` | `{ ok: true, removedIds: string[] }` | "Remove all widgets from the canvas." |
| 9 | `switch_template` | `{ id: TemplateId }` | `{ ok: true }` | "Switch the active canvas template; existing widgets re-flow." |

**Per-tool handler responsibilities.**

- `search_kb`, `fetch_result`: real I/O — call `state.getSearchService()` and
  the source registry. Return clean error envelopes (e.g.,
  `{ results: [], warning: 'index not ready' }`) for expected unhappy paths.
- `read_canvas`, `read_widget`: zero I/O — read from the `canvasSnapshot`
  threaded into the provider call.
- `place_widget`, `link_widgets`: mint a server-side UUID
  (`crypto.randomUUID()`) and include it in the directive. The model can
  reference the id on the same turn (e.g., link two just-placed widgets)
  without waiting for a browser round-trip.
- `switch_template`, `focus_widget`, `clear_canvas`: validate input, return
  the directive. No I/O, no id minting.

## 3. Data flow

### Request shape

`/v1/chat` extends to accept the canvas snapshot:

```ts
// POST /v1/chat
{
  id: string,
  trigger: 'submit-message',
  messages: Array<UIMessage>,         // existing AI SDK 6 parts shape
  canvasSnapshot: {                    // NEW
    activeTemplateId: TemplateId,
    widgets: Array<{
      id: string,
      kind: WidgetKind,
      role: Role,
      title: string,
      payload: object,
    }>,
  },
}
```

The browser computes the snapshot just before submit by walking
`editor.getCurrentPageShapes()` and reading the active template from the
Zustand store. Cheap (~ms for 50 shapes).

If the request omits `canvasSnapshot`, the route defaults to
`{ activeTemplateId: 'ask-anything', widgets: [] }`. This keeps cURL/OpenAI
compatibility tests trivial.

### Per-turn loop trace

User types: *"What's the auth ticket about and where's it implemented?"*

```
T+0ms    browser POST /v1/chat with prompt + canvasSnapshot
T+50ms   backend wraps SDK call:
           ClaudeAgentSdkAdapter.query({ prompt, systemPrompt, canvasSnapshot,
                                         tools: agentTools, abortSignal })
T+1.2s   model emits tool_use: search_kb({query: "auth"})
         backend handler runs SearchService.search → 5 results (~300 tokens)
         tool_result returned to SDK
T+2.0s   model emits tool_use: fetch_result({id: "ticket-101"})
         handler returns full ticket payload (~600 tokens)
T+3.1s   model emits tool_use: search_kb({query: "auth implementation"})
         handler returns code symbol results
T+3.8s   model emits tool_use: place_widget({kind:'ticket', role:'primary',
                                              payload: {...}})
         handler validates → returns { directive: {...}, id: "..." }
T+4.0s   model emits tool_use: place_widget({kind:'code-block', role:'detail',
                                              payload: {...}})
T+4.2s   model emits tool_use: link_widgets({fromId, toId,
                                              label: "implements"})
T+4.5s   model streams text-delta: "TICKET-101 tracks rate-limit hardening on
         the auth service. The implementation lives in `auth/middleware.ts`..."
T+5.1s   SDK loop ends (model's response has no further tool_use)
         providerEventsToUIMS emits: text-end, finish-step, finish, [DONE]

Browser receives chunks as they happen:
  tool-input-available  → loading indicator on chat message
  tool-output-available → if directive, dispatcher.applyToolDirective(editor, dir)
                          → editor.createShape({ type:'llm-wiki:ticket', ... })
                            (using Plan 4e template registry to compute coords
                             from role)
  text-delta            → chat message body grows
```

### System prompt (the actual text)

```
You are llm-wiki, a knowledge assistant. The user has a canvas where you can
place widgets to visualize answers spatially.

Use tools when visual presentation aids the answer (lookups across sources,
multi-item synthesis, walkthroughs). Reply with text only for chitchat,
clarifications, follow-ups about content already on the canvas, or simple
factual questions.

Widget kinds: markdown, code-block, ticket, web-embed, key-value-card.
Roles: primary (main subject), detail (depth on primary), related (adjacent),
reference (citations), timeline (time-anchored), node (graph node).

Search before citing — never invent ids, urls, or quotes.
```

~95 tokens. Tunable during impl but stays under 120.

### Token optimization (design constraint)

1. **Concise tool descriptions** — one sentence each (table above).
2. **Compact tool results** — `search_kb` returns
   `{id, kind, title, snippet, score, source}[]`, not full payloads. Model
   calls `fetch_result(id)` if it needs depth.
3. **Truncated tool acks** — `place_widget` returns `{ok: true, id}`, not echoes.
4. **`read_canvas` returns summaries**, not full widget payloads.
5. **System prompt: ~95 tokens, terse**, with explicit "use tools only when
   visual helps; reply text-only for chitchat / clarifications / simple
   factual answers."
6. **Prompt caching on the stable prefix** — `system` prompt + tool defs go
   behind a `cache_control: {type:'ephemeral'}` breakpoint. Per-turn variant
   parts (`canvasSnapshot` summary, conversation history, current prompt) sit
   *after* the breakpoint so the prefix stays cacheable.
7. **`effort: 'medium'`** for chat turns (SDK default is `'high'`). The
   eventual Plan 3f intent classifier can override to `'high'` for
   `investigate` intent; for Plan 5 v1, always `'medium'`.
8. **`thinking: { type: 'adaptive', display: 'summarized' }`** — adaptive is
   already the Opus 4.7 default, but `display: 'summarized'` is required to
   restore visible thinking content (Opus 4.7's default is `'omitted'`,
   which produces silent loops).
9. **Per-turn iteration cap** of 10 (decision Q5a).

### Token budget per turn (rough)

| Component | First turn (cold) | Repeat turn (cached) |
|-----------|-------------------|----------------------|
| System prompt | 95 | ~10 (cached) |
| Tool definitions | ~1500 | ~150 (cached) |
| Canvas snapshot | 200–1000 (varies) | 200–1000 |
| Conversation history | 0–2000 | 0–2000 |
| User prompt | 50–200 | 50–200 |
| **Input total** | ~2K–5K | ~500–3K |
| Tool I/O (per call) | 300–800 | same |
| Output tokens | up to 8K | up to 8K |

Target per-turn cost for a typical "look up X and place 3 widgets" flow:
~3K input + ~1.5K output, ~$0.05/turn on Opus 4.7.

## 4. Error handling

Four layers, each with a recovery contract:

### Layer 1 — tool input validation (recoverable by model, in-turn)

Each handler runs `schema.parse(input)`. On failure:

```ts
try {
  const parsed = schema.parse(input);
  return await runHandler(parsed);
} catch (e) {
  if (e instanceof z.ZodError) {
    throw new Error(`Invalid input for ${toolName}: ${formatZodError(e)}`);
  }
  throw e;
}
```

The SDK converts thrown errors into a `tool_result` with `isError: true`. The
model sees a structured `tool-output-error` UIMS chunk, can read why it
failed, and retries within the turn. Not user-visible.

### Layer 2 — tool handler runtime error (model recovers OR escalates)

For *expected* unhappy paths (search index empty, source unreachable),
handlers return a clean envelope rather than throw — semantically these are
valid results:

```ts
// search_kb when no index is ready
return { results: [], warning: 'index not ready, no results yet' };
```

For *unexpected* errors (search service crash), throw — model sees the
error and decides: retry, alternate approach, or apologize in text.

### Layer 3 — loop-level bounds (forced termination, surfaced to user)

```ts
options: {
  maxTurns: 10,                                    // Q5a
  maxOutputTokens: 8192,                           // Q5c
  abortController: turnAbortController,            // Q5b
}
```

When `maxTurns` is hit, the SDK emits a `result` message with
`subtype: 'error_max_turns'`. Adapter maps to:

```
ProviderEvent: {type:'error', message:'agent loop exceeded 10 iterations'}
ProviderEvent: {type:'done'}
```

The UIMS adapter forwards as `error` chunk + `finish-step` + `finish` (this
branch already exists in `uims-stream.ts`). User sees partial work + error
toast.

When `maxOutputTokens` is hit, finishReason becomes `'length'`. Map to UIMS
`finish` chunk with `finishReason: 'length'`; useChat surfaces this naturally.

### Layer 4 — stream-level errors (cleanup, no model recovery)

| Event | Backend behavior | User UX |
|-------|------------------|---------|
| User cancel (`chat.stop()`) | browser aborts fetch → `c.req.raw.signal` aborts → forward to SDK's `abortController.abort()` → SDK loop exits → in-flight tool finishes (boundary cancel) → SSE stream closes cleanly | partial widgets/text remain; chat returns to idle |
| Browser tab close | same path — fetch abort propagates | n/a |
| Backend crash mid-loop | SSE stream drops; useChat surfaces `error` state | "connection lost" toast; widgets already placed remain |
| Network blip (browser side) | SSE auto-reconnect not used; fetch fails | error state on the message; user retries |
| SDK auth expired | provider error event with `auth required: run \`claude login\`` | UIMS error chunk; user sees actionable message |

### Cancel implementation (concrete)

```ts
// src/backend/routes/chat.ts (extended)
return stream(c, async (s) => {
  const abortController = new AbortController();
  c.req.raw.signal.addEventListener(
    'abort',
    () => abortController.abort(),
    { once: true },
  );

  const provider = state.getLLMProvider();
  const events = provider.query({
    prompt, systemPrompt, canvasSnapshot,
    abortSignal: abortController.signal,    // NEW
  });

  for await (const sseLine of providerEventsToUIMS(events)) {
    await s.write(sseLine);
  }
});
```

`LLMProvider.query` gains an optional `abortSignal: AbortSignal`. The Claude
Agent SDK adapter wires it to its own `abortController.abort()` if signaled.
Other providers ignore it.

### Browser dispatcher errors (eventual-consistency tradeoff)

```ts
// app/src/canvas/dispatcher.ts
try {
  applyDirective(editor, directive);
} catch (e) {
  console.error('[dispatcher] failed to apply directive:', directive, e);
  showErrorToast(`Couldn't render widget: ${e.message}`);
}
```

The agent doesn't learn about render failures — that's the explicit tradeoff
of Approach 1. Mitigation: input is Zod-validated server-side against the
same payload schemas the browser uses, so the only failures are render-side
bugs (not normal flow).

## 5. Testing strategy

Pyramid: **90% unit / 9% integration / 1% manual**.

### Unit (no network, no SDK)

- **`__tests__/agent/payloads.test.ts`** — one describe per `WidgetKind`:
  accepts valid payload; rejects each missing required field; rejects type
  mismatches; URL validation on `web-embed.url`.
- **`__tests__/agent/tools.test.ts`** — one describe per tool: directive
  shape; UUID minting on `place_widget`/`link_widgets`; per-kind payload
  validation rejects bad input with structured error; reads from snapshot
  (`read_canvas`/`read_widget`); empty-index warning envelope (`search_kb`).
- **`__tests__/uims-stream-tools.test.ts`** — extend `uims-stream.ts`
  coverage:
  - `tool-call` ProviderEvent → `tool-input-available` UIMS chunk with
    `{toolCallId, toolName, input}`
  - `tool-result` ProviderEvent → `tool-output-available` chunk with
    `{toolCallId, output}`
  - `tool-result` with `isError: true` → `tool-output-error` chunk
  - `toolCallId` is stable across paired call/result.
- **`__tests__/app/dispatcher.test.ts`** — `applyToolDirective(editor, directive)`:
  - `place_widget` directive → `editor.createShape` with right type, props
  - `place_widget` with `role` → coords from active template registry
  - `clear_canvas` directive → all `llm-wiki:*` shapes deleted
  - `switch_template` → Zustand store updated, re-flow runs
  - `focus_widget` → `editor.zoomToBounds` on shape's bounds
  - `link_widgets` → arrow shape created between two existing shapes
  - unknown directive type → throws (not silent).

### Integration (mocked LLMProvider, real Hono app)

- **`__tests__/backend-chat-tools.test.ts`** (extends existing
  `__tests__/backend.test.ts`):
  - POST `/v1/chat` with `canvasSnapshot` field → 200; canvas snapshot is
    threaded into provider call (mock provider asserts).
  - POST `/v1/chat` without `canvasSnapshot` → defaults to empty snapshot.
  - mock provider yields `{type:'tool-call', name:'place_widget', input:{...}}`
    → response stream contains `tool-input-available` UIMS chunk.
  - mock provider yields `{type:'tool-result', name:'place_widget', output:{...}}`
    → response stream contains `tool-output-available`.
  - request abort → provider's `query()` receives an aborted signal.
  - mock provider yields `{type:'error', message:'agent loop exceeded ...'}`
    → UIMS `error` chunk + `finish` chunk.

  The mock provider yields a scripted `ProviderEvent[]`. No SDK, no API.

### Frontend component (jsdom, mocked fetch)

- **`__tests__/app/chat-tool-handler.test.ts`** — Chat component:
  - Receives a `tool-output-available` part with a `place_widget` directive
    → calls `dispatcher.applyToolDirective` with that directive.
  - Tool-call without output (still streaming) → renders a "calling tool…"
    indicator on the message.
  - Tool-output-error → renders an error indicator on the message; does
    *not* call dispatcher.

### Manual end-to-end

`__tests__/manual/plan-5-smoke.md`:

1. **Pure chat (no tools)**: `say hi` → only text, no widgets, no tool
   indicators in chat.
2. **Lookup + render**: `tell me about TICKET-101` → tool-call indicators
   for `search_kb` and (likely) `fetch_result` + `place_widget`; ticket
   card on the canvas.
3. **Multi-tool investigation**: `walk me through how auth works` → ≥ 2
   widgets, possibly a `link_widgets` between them.
4. **Cancel mid-loop**: ask a complex question, hit Stop while iterating →
   loop terminates at next boundary; partial widgets remain; no errors in
   browser console.

### Test plumbing one-time additions

- `__tests__/helpers/mock-provider.ts` — yields a scripted
  `ProviderEvent[]`; supports `mock.assertReceivedSnapshot(...)`.
- `__tests__/helpers/canvas-snapshot.ts` — fixture builders for
  `canvasSnapshot` with N widgets of each kind.

### What we're NOT testing (and why)

- **SDK internals** — the agent loop, tool dispatching, model calling.
  That's Anthropic's contract; testing it from our side burns money on
  every CI run for no signal. Mock at the `LLMProvider` boundary.
- **tldraw shape rendering** — visual correctness; not where Plan 5 bugs
  will live.
- **Real LLM responses** — non-deterministic; brittleness > value. Manual
  smoke trace + log checking is enough.

## 6. Out of scope (deferred to later plans)

- **Plan 3b** Ticket indexer (Jira/Linear MCP).
- **Plan 3d** Query enrichment (regex pre-pass for `@file`, `JIRA-NNN`).
- **Plan 3e** Cross-source link resolver (richer than `link_widgets` —
  inferred links from shared identifiers).
- **Plan 3f** Intent classifier (5 intents from design §6); will eventually
  parameterize `effort` per intent.
- **Plan 3g** Cache layer (prompt-cache sized hits, result-cache,
  embedding-cache).
- **Pin / unpin / annotate / arrange** — Plan 5b candidates if dogfooding
  shows users want them.
- **Multi-user concurrency** — out of scope per design §1.
- **Write-back tools** (mutating sources via MCP write-side tools) — out of
  scope; Plan 5 is read-only.

## 7. Open risks (and mitigations)

- **Model places too many widgets per turn.** Mitigation: prompt explicitly
  encourages thrift; iteration cap of 10 bounds worst-case; canvas
  templates make 6+ widgets visually awkward (self-correcting feedback).
- **Tool descriptions confuse the model.** Mitigation: minimal one-sentence
  descriptions; manual smoke trace catches early; system prompt repeats
  the kind/role vocabulary so it's redundant with tool param descriptions.
- **Browser dispatcher silently drops directives.** Mitigation: every dispatch
  failure logs to console + shows toast; dispatcher tests cover all
  directive types; both backend and browser import the same TS types so a
  schema change breaks compile.
- **Eventual consistency confuses the user.** If `place_widget` succeeds but
  the browser fails to render, the model thinks it's done; user sees
  nothing. Plan 5 accepts this; Plan 5b can add a render-ack channel if
  it becomes a real problem.

## 8. Success criteria

After Plan 5 ships:

1. Typing `tell me about TICKET-101` in chat causes the model to autonomously
   call `search_kb`, place at least one widget on the canvas, and stream a
   coherent text reply — all within one chat submission.
2. Typing `say hi` produces only text, no tool calls, no widgets.
3. Hitting Stop mid-loop terminates cleanly; partial widgets remain; no
   uncaught errors in browser console.
4. Per-turn token cost on a typical "look up X" investigation is under
   ~5K input + ~2K output on Opus 4.7.
5. All unit and integration tests pass; manual smoke trace runs cleanly.
6. The 9 tools are individually documented (description in code) and
   testable as pure functions.

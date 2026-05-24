# Plan — Unified Agent via Vercel AI SDK

**Status:** draft, not yet started
**Last updated:** 2026-05-24
**Owner:** krunal
**Tracking:** none (no PR yet)

---

## 1. Context

The Railway demo on Gemini Flash returns text-only responses when asked to place widgets on the canvas. Investigation (`src/providers/`) confirmed the cause is structural: only `claude-agent-sdk.ts` (684 LOC) has tool-calling plumbing; every other adapter (`openai.ts`, `gemini.ts`, `groq.ts`, `ollama.ts`, `openrouter.ts`, `anthropic-direct.ts`) is a pure text wrapper with **zero** references to `place_widget`, `tool_calls`, or any agent surface. So Gemini physically can't invoke `place_widget` — there's no code path.

This forces a two-tier UX: Claude users get the full agent; everyone else gets a chat box that pastes HTML/CSS into the message stream. That's a bug, not a feature.

**Decision (2026-05-24):** users should get the **same experience regardless of provider**. Memory: `project-unified-agent-architecture.md`.

## 2. Goal

A single chat path, the same set of OpenCanvas tools, working with any model that supports function calling — Gemini, Claude, GPT, Llama (Groq/Ollama), Mistral, Cohere, etc. Provider becomes a config switch with no behavioural divergence.

## 3. Non-goals

- **Not** preserving Claude Code's built-in tools (Read/Write/Bash/Glob/Grep/Edit/TodoWrite) inside OpenCanvas. They don't fit the canvas product surface; users who want them should use Claude Code directly.
- **Not** preserving Claude SDK's native session-id continuity. Replaced by explicit history management (which is how every non-Claude provider already works).
- **Not** rewriting the client. The React app uses `useChat` from `@ai-sdk/react@^3` — it speaks UIMS already. The server-side `toUIMessageStreamResponse()` will produce the same protocol on the wire.
- **Not** dropping support for any LLM provider. The list shrinks at the *adapter* layer (we delete custom adapters) but expands at the *provider* layer (any AI-SDK-supported model works).

## 4. Current architecture (broken-for-non-Claude)

```
React app  ────[useChat / UIMS]────►  POST /v1/chat
                                        │
                                        ├─ splitMessages() → prompt + history + system
                                        ├─ resolve provider via OPENCANVAS_LLM_PROVIDER
                                        │
            ┌───────────────────────────┴───────────────────────────┐
            │                                                       │
            ▼                                                       ▼
   ClaudeAgentSdkAdapter                                  Every other adapter
   (684 LOC)                                              (OpenAI / Gemini / Groq /
   • Tool-calling loop                                    Ollama / OpenRouter /
   • src/agent/tools/* registered                         AnthropicDirect)
   • MCP server integration                               • Plain chat-completion stream
   • Sub-agents (team route)                              • No tools, no widget placement
   • Native session continuity                            • Returns text deltas only
            │                                                       │
            └─────────► providerEventsToUIMS() ◄────────────────────┘
                          │
                          ▼
                       SSE to browser
```

## 5. Target architecture (single path)

```
React app  ────[useChat / UIMS]────►  POST /v1/chat
                                        │
                                        ├─ build  messages: ModelMessage[]
                                        ├─ build  tools:    OpenCanvasTools
                                        ├─ build  system:   SystemPromptBuilder()
                                        ├─ resolve model:   resolveAiSdkModel(env)
                                        │
                                        ▼
                          streamText({
                            model, messages, tools, system,
                            stopWhen: stepCountIs(N),
                            experimental_telemetry: { isEnabled: false },
                          })
                                        │
                                        ▼
                       toUIMessageStreamResponse()
                                        │
                                        ▼
                                  SSE to browser
```

Provider resolution lives in **one** new file, `src/agent/model-resolver.ts`:

```ts
// pseudo-code
export function resolveAiSdkModel(profile: Profile): LanguageModel {
  switch (profile.llm.provider) {
    case 'anthropic':   return anthropic(profile.llm.model);
    case 'openai':      return openai(profile.llm.model);
    case 'google':      return google(profile.llm.model);
    case 'groq':        return groq(profile.llm.model);
    case 'openrouter':  return openrouter(profile.llm.model);
    case 'ollama':      return createOllama({ baseURL: ... })(profile.llm.model);
    case 'mistral':     return mistral(profile.llm.model);
    // ...
  }
}
```

Tools live in `src/agent/tools/*` (existing location) but rewritten to AI SDK shape (see Phase 1).

## 6. Phased plan

Each phase is independently shippable and reversible. We use a feature flag (`OPENCANVAS_AGENT=v2`) to keep the v1 path as the default until v2 is verified.

### Phase 1 — Port tools to AI SDK format (3-4 h)

**What:** rewrite the 18 tools in `src/agent/tools/` from
`tool('name', '...desc...', inputShape, async (args, ctx) => {...})` (Claude SDK shape)
to AI SDK's `tool({...})` shape:

```ts
import { tool } from 'ai';
import { z } from 'zod';

export const placeWidget = (ctx: OpenCanvasToolCtx) => tool({
  description: '...',
  inputSchema: z.object({ kind: z.string(), role: z.enum(ROLES), payload: z.record(z.unknown()) }),
  execute: async ({ kind, role, payload }, { abortSignal }) => {
    // body — same logic, but uses ctx.widgetBus instead of Claude SDK hooks
    return { ok: true, id, directive };
  },
});
```

**Files touched:**
- `src/agent/tools/_shared.ts` — new `OpenCanvasToolCtx` type (replaces `AgentToolDeps`)
- `src/agent/tools/*.ts` (17 files) — convert each one
- `src/agent/tools/index.ts` — new aggregator `buildOpenCanvasTools(ctx): Record<string, Tool>`

**What stays:** the schemas (already Zod), the descriptions, the side-effect logic.
**What changes:** the `tool()` factory import, the second-argument signature, the way directives reach `WidgetStreamBus`.

**Done when:** all 18 tools compile under AI SDK's `Tool` type. No runtime exercise yet.

### Phase 2 — New `streamText` chat path behind a flag (3-4 h)

**What:** add a v2 branch to `src/backend/routes/chat.ts` that runs `streamText({...})` instead of the LLMProvider loop, gated on `process.env.OPENCANVAS_AGENT === 'v2'`. v1 stays the default.

**Concrete shape (~80 LOC):**

```ts
// inside chat.ts
if (process.env.OPENCANVAS_AGENT === 'v2') {
  const tools = buildOpenCanvasTools({
    search, webSearch, getSnapshot, streamBus,
    plugins, getNotebookStore, getWidgetRegistry,
  });
  const result = streamText({
    model: resolveAiSdkModel(state.profile),
    system: await buildSystemPrompt(state, body.canvasSnapshot),
    messages: convertToModelMessages(body.messages),
    tools,
    stopWhen: stepCountIs(state.profile.llm.maxSteps ?? 8),
  });
  return result.toUIMessageStreamResponse(); // returns Response with UIMS body
}
// v1 path unchanged below
```

**Files touched:**
- `src/backend/routes/chat.ts` — add the v2 branch
- `src/agent/system-prompt.ts` — new file extracting the prompt-building logic from `claude-agent-sdk.ts` (the system prompt is currently inlined there)
- `src/agent/model-resolver.ts` — new

**Provider deps to add:**
- `@ai-sdk/anthropic`
- `@ai-sdk/openai`
- `@ai-sdk/google`
- `@ai-sdk/groq`
- `@openrouter/ai-sdk-provider` (community)
- `ollama-ai-provider`
- `@ai-sdk/mistral` (optional)

**Done when:** `OPENCANVAS_AGENT=v2 OPENCANVAS_LLM_PROVIDER=google` on the live Railway demo, chat "place a sticky note saying hi" → widget appears on canvas. Same for `provider=anthropic` locally.

### Phase 3 — MCP source integration via AI SDK MCP client (2-3 h)

**What:** existing MCP source support lives in `claude-agent-sdk.ts`. Port it to AI SDK's `experimental_createMCPClient` (now stable enough — used in production by Vercel's own examples).

**Concrete shape:**

```ts
// inside chat.ts v2 path
const externalTools: Record<string, Tool> = {};
for (const source of state.profile.sources) {
  const client = await experimental_createMCPClient({ transport: ... });
  Object.assign(externalTools, await client.tools());
}
const tools = { ...buildOpenCanvasTools(ctx), ...externalTools };
```

**Files touched:**
- `src/agent/mcp-integration.ts` — new
- `src/backend/routes/chat.ts` — wire it into the v2 branch
- `src/mcp/transport.ts` — possibly adapter to AI SDK's transport interface

**Done when:** a configured MCP source (e.g. `@modelcontextprotocol/server-filesystem`) is callable from any model under v2.

### Phase 4 — Migrate `team` route to multi-step `streamText` (2-3 h)

**What:** the `/v1/team` route runs Researcher → Builder → Critic sequentially. Currently uses `claude-agent-sdk`'s native task tool. Reimplement as three sequential `streamText` calls, each with a different `system` prompt, sharing the conversation context.

**Files touched:**
- `src/backend/routes/team.ts` — rewrite
- `src/agent/team-prompts.ts` — new (extracted prompts)

**Done when:** `POST /v1/team` returns three phases as one UIMS stream, same client experience.

### Phase 5 — Delete the old adapters and provider abstraction (1-1.5 h)

**What:** remove the now-redundant code:

| File | Action |
|---|---|
| `src/providers/openai.ts` | delete |
| `src/providers/gemini.ts` | delete |
| `src/providers/groq.ts` | delete |
| `src/providers/ollama.ts` | delete |
| `src/providers/openrouter.ts` | delete |
| `src/providers/anthropic-direct.ts` | delete |
| `src/providers/claude-agent-sdk.ts` | delete |
| `src/providers/amp.ts` | keep — Amp uses its own MCP protocol, not standard AI-SDK shape |
| `src/providers/index.ts` | reduce to a re-export of `model-resolver.ts` + `amp.ts` |
| `src/core/provider.ts` | delete `LLMProvider` interface; keep `ProviderEvent` only if `Amp` still emits it |
| `src/backend/state.ts` | drop `LLMProvider` references; expose `resolveAiSdkModel(profile)` instead |
| `src/config/schema.ts` | flatten provider literals (`'claude-agent-sdk'` → `'anthropic'`) |

**Done when:** `pnpm typecheck` + `pnpm test` pass with v2 as the only path.

### Phase 6 — Config flat-rename + docs (30 min)

Provider literals shift to match the AI SDK convention:

| Old | New |
|---|---|
| `claude-agent-sdk` | `anthropic` |
| `anthropic-direct` | (merged into `anthropic`) |
| `openai` | `openai` |
| `openrouter` | `openrouter` |
| `groq` | `groq` |
| `gemini` | `google` |
| `ollama` | `ollama` |
| `amp` | `amp` |

Add a migration shim in `loadConfig()` that maps the old strings to the new ones with a `console.warn`, so existing `~/.opencanvas/config.json` files keep working for a release.

**Docs to update:**
- `README.md` — provider matrix
- `docs/deploy-railway.md` — env var examples
- `docs/openapi.yaml` — provider enum in profile schema
- `CHANGELOG.md` — breaking-change entry

### Phase 7 — Flip the default + remove the flag (15 min)

- Remove `process.env.OPENCANVAS_AGENT` check from `chat.ts`; v2 is the only path.
- Delete the v1 branch.
- One small commit: `chore: remove v1 agent path, v2 is default`.

## 7. Test strategy

### What we keep

Existing `__tests__/agent/` covers tool behaviour (`place-widget.test.ts`, etc.). Most of those tests exercise the `execute()` function with a mock `AgentToolDeps`. Rewrite the deps factory to produce the new `OpenCanvasToolCtx` shape — bodies stay.

### What we add

- `__tests__/agent/model-resolver.test.ts` — assert each provider literal resolves to the right `LanguageModel` instance and rejects unknown literals.
- `__tests__/backend/routes/chat-v2.test.ts` — end-to-end test using AI SDK's `MockLanguageModelV2` to simulate a model that calls `place_widget` and `search_kb`. Assert UIMS output frames.
- `__tests__/agent/mcp-integration.test.ts` — fake MCP server, assert tools are discovered and callable.

### Manual verification per phase

| Phase | Verify |
|---|---|
| 1 | `pnpm test` passes; no runtime change |
| 2 | Live Railway demo with `OPENCANVAS_AGENT=v2 OPENCANVAS_LLM_PROVIDER=google` → "place a yellow sticky note saying 'hi'" → widget appears |
| 3 | Local: configure an MCP filesystem source; ask the model to list `~/Documents/notes/`. Verify it calls the source via the model. |
| 4 | `POST /v1/team` with `{prompt: "design a pomodoro timer widget"}` → three phases stream back with the right phase tags |
| 5 | `pnpm typecheck && pnpm test` — clean |
| 6 | `~/.opencanvas/config.json` with `provider: "claude-agent-sdk"` still works (with the warning) |
| 7 | All providers (gemini, anthropic, openai, groq, ollama) produce equivalent canvas behaviour for a benchmark prompt |

## 8. Rollout

1. Feature branch: `feat/unified-agent`
2. Implement Phases 1-4 → push behind the flag
3. On the live Railway demo, set `OPENCANVAS_AGENT=v2` + verify
4. Land Phase 5 (delete adapters) once v2 is stable for ~1 week
5. Phase 6 + 7 in a follow-up

**Rollback path:** for Phases 1-4, unset `OPENCANVAS_AGENT` and v1 takes over. For Phase 5 onward, `git revert` is the only path — but by then v2 has been running on real traffic for a week.

## 9. Risks & open questions

| Risk | Mitigation |
|---|---|
| AI SDK tool calling has provider-specific quirks (Gemini's tool-call streaming is famously flaky) | The SDK already handles most; we'll discover residuals during Phase 2 live testing. If Gemini specifically misbehaves, we can pin to `gemini-2.5-flash` (which has better tool-call support than `flash-lite`). |
| `experimental_createMCPClient` instability | Used by Vercel internally; pin a known-good AI SDK version. Worst case: fall back to a manual MCP-to-tool bridge (~3h extra). |
| `team` route loses native sub-agent isolation | Multi-step prompting with explicit role transitions is well-trodden ground. The team route's UX (three phases streamed as one message) is the contract; the *implementation* can change. |
| Existing users on `provider: "claude-agent-sdk"` get a config error | Shim with `console.warn` in `loadConfig()` for at least one release. Document in `CHANGELOG.md`. |
| Larger vendor bundle from extra `@ai-sdk/*` providers | Each provider package is ~10-30KB; total < 200KB raw added. Negligible. |
| Breaking changes for local CLI users | The CLI (`pnpm cli`) goes through the same chat path. Phase 5 will need a CLI-mode verification. |

**Open questions:**

- **Reasoning / extended thinking:** AI SDK exposes `reasoning` deltas for Anthropic; for other providers it's missing. The current UI surfaces a "thinking" pane. Does it gracefully hide when the active model doesn't emit reasoning? Need to verify in Phase 2.
- **Prompt caching:** AI SDK passes `providerOptions: { anthropic: { cacheControl: ... } }` through. For OpenCanvas the system prompt is large (canvas snapshot, tool descriptions, plugin kinds) — caching matters. Confirm AI SDK forwards it correctly.
- **Tool result streaming:** the `stream_widget` tool currently emits widget payload incrementally via `WidgetStreamBus`. Does `streamText` allow a tool's `execute()` to push intermediate frames before returning a final result? Need to use `experimental_toolCallStreaming` or restructure to a single final return.

## 10. Definition of done (whole project)

- Live Railway demo on Gemini Flash Lite Latest places real widgets when asked.
- Local OpenCanvas on Claude Sonnet 4.6 places real widgets and exhibits no regression from current behaviour.
- `pnpm test` is clean.
- `src/providers/` contains at most `amp.ts` + a re-export.
- `OPENCANVAS_LLM_PROVIDER=ollama` with a local Llama 3.x model places widgets.
- README's provider matrix shows all supported providers with identical capability footprint.

---

**Memory:** [[project-unified-agent-architecture]] (the architectural decision)
**Related:** [[project-branch-protection]] (push directly to main; no force-push)

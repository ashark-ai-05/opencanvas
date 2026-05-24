# I rewrote OpenCanvas's agent loop so any LLM can drive it — and learned why "vendor-agnostic AI" is harder than it looks

*Draft. Target: dev.to, ~2500 words. Author: krunal.*
*Tags: ai, llm, typescript, opensource*

---

## The bug that started it

OpenCanvas is an infinite canvas where an LLM places typed widgets — markdown, charts, mermaid diagrams, code blocks, custom HTML. The pitch on the README said "BYO model — works with any provider that supports function calling."

Last week I deployed it to a public demo on Railway, configured with Gemini Flash Lite on the free tier so visitors could try it without a key. A friend opened the demo, asked it to "show me a pomodoro timer," and got back:

> Here's the pomodoro timer code:
> ```html
> <div id="pomodoro-app">...
> ```

Just markdown. No widget. The agent printed the HTML, didn't render it.

When I tested locally with Claude Sonnet, everything worked. The agent placed real widgets. The same prompt, same code path, completely different behavior.

This is the story of why, and what I had to rebuild to fix it.

---

## What "function calling" actually means across providers

If you've never built tool-calling into an LLM app before, here's the short version:

1. You define functions the model can call: name, description, JSON-schema for arguments.
2. You send those definitions along with the user's prompt.
3. The model returns either text *or* a structured "call this function with these args" message.
4. You execute the function, send the result back, model continues.

It's elegant in theory. In practice, **every provider implements it differently**:

| Provider | Format | Streaming shape |
|---|---|---|
| OpenAI | `tools: [{type:'function', function:{...}}]` | Progressive — args stream in chunks |
| Anthropic | `tools: [{name, description, input_schema}]` | Block-at-a-time — args arrive as a complete unit at the end |
| Google Gemini | `tools: [{functionDeclarations:[...]}]` (native) OR OpenAI-compat shim at `/v1beta/openai` | Different in each — the OpenAI shim has known bugs around tool calls |
| Groq | OpenAI-compatible, but silently strips tool calls on some models | Same as OpenAI when it works |
| Ollama | OpenAI-compatible, only on specific local models | Local; depends on model |

OpenCanvas's original architecture had a `LLMProvider` interface — one adapter per provider, each implementing its own tool-calling loop. There were eight adapters: claude-agent-sdk, anthropic-direct, openai, openrouter, groq, gemini, ollama, amp.

Here's the kicker: **only one of them had tool-calling implemented.** The Claude Agent SDK adapter was 684 lines, with full MCP integration, sub-agent spawning, native session continuity. The other seven? Pure text wrappers. About 100 lines each, zero references to `place_widget`, `tool_calls`, or any agent surface.

The README said "any provider works." The code said "Claude works, everything else returns plain text."

That's why my friend's demo failed. The demo ran on Gemini. Gemini was wired through the text-only adapter. The model could write *about* placing a widget, but it could never actually call the tool.

---

## Two paths forward

I had two options:

**Option A: implement tool-calling per provider, hand-rolled, ~30-50 lines × 7 providers.** Maintainable for a week, nightmare to keep working as each provider's API evolves. Every Gemini release adds a wrinkle. Groq's tool-call output stripping is undocumented and changes by model.

**Option B: drop the bespoke `LLMProvider` interface entirely. Use Vercel AI SDK as the unifier.** AI SDK already normalizes function calling across every major provider — it has shims for OpenAI, Anthropic, Google, Groq, Mistral, Cohere, OpenRouter, Ollama, and ~20 others. They maintain the bug-for-bug compatibility shims as their primary value proposition. Each provider becomes one import.

Option B was clearly correct in principle. In practice, it meant rewriting:

- The 17 tools in `src/agent/tools/` from Claude Agent SDK shape to AI SDK shape
- The chat route's per-provider dispatch
- The team route's multi-agent orchestration (Researcher → Builder → Critic)
- The MCP source integration (AI SDK 6 removed the MCP client; I'd need to build one)
- The agent's session continuity (Claude's native session-id was provider-specific)

Total: ~12-20 hours of focused work. Most of it mechanical, some of it tricky.

I went with Option B.

---

## Phase 1: porting the tools

Each tool in the codebase looked like this (Claude Agent SDK shape):

```ts
import { tool } from '@anthropic-ai/claude-agent-sdk';

export function placeWidgetTool(plugins) {
  return tool(
    'place_widget',
    'Place a widget on the canvas at the role\'s slot...',
    {
      kind: z.string().describe('...'),
      role: z.enum(ROLES).describe('...'),
      payload: z.record(z.unknown()),
    },
    async (args) => {
      const directive = { type: 'place', id: randomUUID(), ...args };
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, directive }) }],
      };
    },
  );
}
```

AI SDK's shape is similar but moves the name into the dict key the model sees:

```ts
import { tool } from 'ai';

export const placeWidgetToolV2 = (ctx) => tool({
  description: 'Place a widget on the canvas at the role\'s slot...',
  inputSchema: z.object({
    kind: z.string().describe('...'),
    role: z.enum(ROLES).describe('...'),
    payload: z.record(z.unknown()),
  }),
  execute: async (args) => {
    const directive = { type: 'place', id: crypto.randomUUID(), ...args };
    return { ok: true, directive };
  },
});

// Aggregator
const tools = {
  place_widget: placeWidgetToolV2(ctx),
  // ...16 more
};
```

The mechanical bits:
- Schema becomes a full `z.object(...)`, not a raw shape
- Return the result object directly — AI SDK serializes; no manual `{content: [{type:'text',text:JSON.stringify(...)}]}` envelope
- Name moves to the aggregator key

The non-mechanical bits:
- Some tools needed to push to a `WidgetStreamBus` (per-chat-turn event channel for streaming widget builds). The bus reference threads through `ctx`.
- The notebook tools needed a `getNotebookStore()` getter — passed via `ctx`, omitted when unavailable so the model never sees a broken tool.

I dispatched three subagents in parallel — one per logical group (read-only tools, mutation tools, notebook tools). They each got the pattern from two reference conversions I'd done by hand. Three hours of mechanical work compressed into 15 minutes of agent time.

When they finished, the v1 builders still existed alongside the new v2 ones. The Claude path used v1; nothing else changed. Risk surface contained to a single config flag.

---

## Phase 2: the streamText chat route

Once the tools spoke AI SDK shape, the chat route became laughably simple:

```ts
const result = streamText({
  model: await resolveAiSdkModel(state.profile),
  system: buildSystemPrompt({ canvasSnapshot, externalSources }),
  messages: convertToModelMessages(uiMessages),
  tools: buildOpenCanvasTools(ctx),
  stopWhen: stepCountIs(8),
});

return result.toUIMessageStreamResponse();
```

That's it. Five method calls replaced 684 lines of `claude-agent-sdk.ts`.

The `resolveAiSdkModel` function is the actual provider switch:

```ts
switch (llm.provider) {
  case 'anthropic': return anthropic(llm.model);
  case 'openai': return openai(llm.model);
  case 'gemini': return createGoogleGenerativeAI({ apiKey })(llm.model);
  case 'groq': return groq(llm.model);
  case 'openrouter': return openrouter(llm.model);
  case 'ollama': return createOllama({ baseURL })(llm.model);
}
```

Six lines. Six providers. The model name and key threading is all per-provider; everything downstream is identical.

I gated the whole thing behind `OPENCANVAS_AGENT=v2`. The v1 path stayed live as the default. I flipped Railway's env var, set Gemini, hit `/v1/chat`:

```
data: {"type":"tool-input-start","toolName":"place_widget"...
data: {"type":"tool-output-available","output":{"ok":true,"directive":{...}}}
data: {"type":"text-delta","delta":"OK. I've placed the yellow sticky note."}
```

Gemini Flash Lite calling `place_widget`. The exact thing that was impossible 12 hours earlier.

---

## Phase 3: MCP — and a curveball

OpenCanvas's killer feature is MCP source integration. The agent can use any MCP server's tools — your filesystem, a GitHub source, a custom server you wrote. In v1, the Claude Agent SDK spoke MCP natively. I'd assumed AI SDK would too.

It used to. AI SDK 5 shipped `experimental_createMCPClient`. I checked AI SDK 6 — gone. Removed.

There are good reasons (MCP spec was still moving; the experimental API didn't keep pace). But for us, that meant building the MCP-to-AI-SDK bridge ourselves.

The bridge ended up being ~110 lines:

```ts
for (const config of state.profile.sources) {
  const client = await createMcpClient(config);  // existing @modelcontextprotocol/sdk
  const listed = await client.listTools();
  for (const t of listed.tools) {
    tools[`mcp__${config.id}__${t.name}`] = tool({
      description: t.description,
      inputSchema: jsonSchema(t.inputSchema),  // MCP returns JSON Schema; AI SDK accepts via jsonSchema()
      execute: async (args, opts) => client.callTool({
        name: t.name,
        arguments: args
      }, undefined, { signal: opts.abortSignal }),
    });
  }
}
```

That gave any AI-SDK-supported model access to any MCP server's tools, named in the convention v1 already used (`mcp__<source>__<tool>`).

The `jsonSchema()` helper is the unsung hero. MCP tools declare their inputs as JSON Schema; AI SDK's `tool()` wants a Zod schema or a `FlexibleSchema`. `jsonSchema(jsonSchemaObject)` returns a wrapper that satisfies the latter without manual conversion. Took me longer to find than to use.

---

## Self-improving widgets

While I was in there, I figured I'd add the feature the README *also* promised — "the canvas learns your widgets over time."

The shape: the agent registers a plugin widget kind at runtime via `register_widget_kind`. Subsequent `place_widget` calls reference the registered kind. So the agent can:

1. User asks for a custom dashboard
2. Agent builds the HTML inline via the `html` plugin
3. **Agent recognizes this is reusable** — calls `register_widget_kind` with the HTML as a srcdoc template, variable bits parametrized as props
4. Next time anyone asks for a similar dashboard, the agent calls `place_widget(kind: 'my-dashboard', payload: {data: ...})` instead of re-rolling the whole HTML

Step 4 is one tool call. Step 2 is forty lines of HTML the model has to write every time. The difference at scale is massive — token cost, latency, error rate.

To make this persistent across sessions: `register_widget_kind` writes the descriptor to disk (`~/.opencanvas/templates.json`). At backend startup, the registry loads these and re-registers them. Future sessions inherit the agent's prior learning.

The system prompt teaches the agent the three-step flow:

> 1. Call `list_templates` first — see what's already available.
> 2. If a fit exists → `place_widget(kind: '<template>', payload: {...})`.
> 3. If novel + reusable → `register_widget_kind` with a parametrized srcdoc.

For pure one-shots, there's still the universal `html` plugin (with a hard-error fallback when payload.html is missing — more on that below).

Plus a bonus: after every successful `place_widget(kind: 'html', ...)` with non-trivial HTML, an *extractor* LLM call runs in the background. It generalizes the HTML into a template and auto-registers it. The agent learns even when it doesn't explicitly decide to save.

Token cost per extraction: ~$0.0005 on Flash Lite Latest. With a per-process MAX_CONCURRENT=2 cap, this never spirals.

---

## The bug-hunt war stories (these are why you read this)

The migration itself was the *easy* part. The hard part was every silent failure mode that surfaced after.

### Bug 1: the TDZ

After the migration, the SPA started rendering a blank white page. Console: `Uncaught ReferenceError: Cannot access 'Z' before initialization at vendor-D-7Zb80G.js:9:4310`.

The cause: Vite's `manualChunks` config was splitting `react-markdown` (and friends) into a `vendor-markdown` chunk. Some packages in the catch-all `vendor` chunk imported symbols *from* `vendor-markdown` — and `vendor-markdown` imported symbols *back* from `vendor`. Circular cross-chunk imports.

When Rollup minifies, those symbols become `Z`, `H1`, `Ot`, etc. When chunk A loads before chunk B but A imports from B, A reads `Z` before B has initialized it. Temporal dead zone error.

The fix that took longest to find: **drop the vendor-markdown manual chunk entirely.** Let Rollup auto-bundle. ~140KB more in the catch-all vendor chunk; zero cross-chunk seams.

Same fix shape applied to a *latent* `vendor-react` cycle that wasn't biting yet but would have within weeks.

**Lesson**: Vite's `manualChunks` is fragile when a chunk's dep graph isn't a clean cut. Safe candidates are libraries with isolated dep graphs (tldraw — huge, self-contained). Unsafe candidates: anything that participates in a peer-dep ecosystem (react + everything react-adjacent; unified + its plugins). When in doubt, fewer manual chunks.

### Bug 2: CSP shutting down CDN scripts

I added a Mermaid plugin widget. The renderer was a sandboxed iframe with `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js">`. Worked locally. Failed on the live demo with my own error handler: `Could not load mermaid from cdn.jsdelivr.net`.

Cause: the SPA ships with a strict `script-src 'self'` Content-Security-Policy. **That policy applies to scripts loaded inside `srcdoc` iframes too** — even sandboxed ones. The CDN load was getting blocked.

The fix: bundle mermaid + vega + vega-lite + vega-embed and serve them same-origin under `/vendor/`. A tiny `scripts/copy-vendor-libs.mjs` runs as `preapp:build` and copies dist files from `node_modules` to `app/public/vendor/`. Srcdocs reference `/vendor/mermaid.min.js`. CSP `'self'` covers them.

**Lesson**: sandboxed iframes inherit *some* CSP from the embedder (specifically `script-src` for inline + cross-origin scripts). If your security model is strict, plan for same-origin CDN copies.

### Bug 3: the `</script>` escape

The mermaid renderer was now loading. But when the agent rendered a *user-asked* HTML widget — say, an animated sine wave with embedded `<script>` tags — the iframe showed the prop-bridge shim's source code as visible text.

The cause was a classic JSON-in-HTML escape bug. The shim that injects props into the iframe is:

```html
<script>
  window.opencanvas.props = ${JSON.stringify(props)};
  // ... more
</script>
```

If `props.html` (the user's HTML) contains `</script>`, the HTML tokenizer sees that inside the JSON string and **closes the wrapping script tag** prematurely. Everything after renders as visible text.

Fix:

```ts
const initial = JSON.stringify(props).replace(/<\/(script|style)/gi, '<\\/$1');
```

The JavaScript parser treats `<\/script>` identically to `</script>` inside a string literal. The HTML tokenizer no longer sees a closing tag.

**Lesson**: this is the canonical JSON-in-HTML bug. Any time you inject user-controlled JSON inside a `<script>` block, you need this escape. Next.js, Rails, every server-rendered framework has its own version of the fix. Easy to forget when you're not in template territory.

### Bug 4: DOMParser strict-XML rejecting mermaid

Mermaid renders SVG. I was inserting that SVG into the DOM via:

```ts
const doc = parser.parseFromString(svgString, 'image/svg+xml');
container.appendChild(doc.documentElement);
```

Worked for flowcharts. Failed silently for sequence diagrams — blank white widget.

The cause: mermaid's sequence diagrams use `<foreignObject>` with HTML labels inside. `image/svg+xml` is strict XML; HTML embedded inside foreignObject gets rejected silently. The DOMParser returns a parsererror, which I wasn't checking, so the appendChild call silently no-op'd.

Fix:

```ts
const doc = parser.parseFromString(svgString, 'text/html');
const svg = doc.body.querySelector('svg');
if (!svg) throw new Error('DOMParser returned no <svg>');
container.appendChild(document.importNode(svg, true));
```

`text/html` mode handles inline SVG including foreignObject correctly.

**Lesson**: this is a slightly different version of the "make failures loud" principle. The `image/svg+xml` parse was silently producing an unusable document. Once I added a `throw` for the no-svg case, the next time something broke I had a real error message to work with — not a blank box.

---

## What I learned

Five takeaways from the migration:

1. **Bug-for-bug compatibility shims are a real product.** Vercel AI SDK earns its keep — they maintain the per-provider quirks I would have spent months hand-rolling. The ~12 hours I spent migrating to it is going to pay for itself the first time a provider ships a breaking API change.

2. **"Same UX everywhere" is a product decision, not a technical one.** OpenCanvas's prior architecture had Claude as a special case because Claude got the work first. Unwinding that meant deleting working code (the 684-line claude-agent-sdk adapter). Hard to do without a clear product principle: every model gets the same agent.

3. **Silent failures cost more than loud ones.** Bug 4 (the DOMParser SVG rejection) wasted hours because the failure mode was "blank box." Adding a single `throw` made every future iframe issue surface in seconds. The investment to *make failures loud* — `window.onerror` handlers, visible status states, error-message UIs inside the iframe — pays back within one debugging cycle.

4. **`manualChunks` is fragile.** Vite/Rollup's chunk-splitting is intuitive for clean dep graphs and lethal for entangled ones (react + the markdown ecosystem + everything react-adjacent). Default to fewer chunks; only split self-contained dependencies.

5. **MCP is going to be everywhere.** Building the AI SDK ↔ MCP bridge in 110 lines was the easiest part of this whole migration. The Model Context Protocol is the right level of abstraction for tool calling; it'll show up in every agent runtime within the year.

---

## The result

OpenCanvas's public demo runs on Gemini Flash Lite Latest (free tier). It places real widgets. The unified-agent migration is on `main`; the local-first install works with Ollama; the same code drives Claude Sonnet, GPT-4o, and Llama 3.3 via Groq.

The codebase is *smaller* than before — `src/providers/claude-agent-sdk.ts` will be deleted next session, along with five other now-redundant adapters. The agent's effective capability is *larger* — Gemini can do everything Claude can do, plus the agent's library auto-extends from every novel render.

If you're building an agentic app and finding yourself maintaining N provider adapters: the AI SDK + MCP combo is worth the migration. It's the cheapest piece of infrastructure I've adopted in years.

---

**Try it**: [opencanvas-production.up.railway.app](https://opencanvas-production.up.railway.app)
**Code**: [github.com/ashark-ai-05/opencanvas](https://github.com/ashark-ai-05/opencanvas) — MIT
**Local install**: `npx degit ashark-ai-05/opencanvas && cd opencanvas && pnpm install && pnpm electron:dev`

If you bring your own API key via the gear icon, the rate limit goes away and you can throw the whole thing at any model you want. The demo's a fun playground; the local install is where the self-improving widgets really shine across sessions.

Tell me what your model places.

---

*Editor's note for the publishing pass:*
- *Capture 2-3 30s clips of the agent placing different widget kinds for embed*
- *Star the repo, get the chart embed at the top updating*
- *Cross-post to Substack and r/LocalLLaMA the day after*

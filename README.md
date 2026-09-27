<div align="center">

<img src="build/icons/icon-256.png" alt="OpenCanvas" width="112" height="112" />

# OpenCanvas

### Stop reading AI replies. Watch them assemble on an infinite canvas.

Ask a question. Instead of five paragraphs, you get a chart, a table and a kanban, side by side, each one a real widget you can drag, pin and keep. Any model. Your machine. MIT.

[![ci](https://github.com/ashark-ai-05/opencanvas/actions/workflows/ci.yml/badge.svg)](https://github.com/ashark-ai-05/opencanvas/actions/workflows/ci.yml) [![tests](https://img.shields.io/badge/tests-775%20passing-2dd4bf)]() [![tsc](https://img.shields.io/badge/tsc-clean-a78bfa)]() [![license](https://img.shields.io/badge/license-MIT-fbbf24)](./LICENSE) [![security](https://img.shields.io/badge/security-policy-22c55e)](./SECURITY.md)

![demo](docs/demo.gif)

<p>
  <a href="https://opencanvas-production.up.railway.app"><b>▶︎ Try the live demo</b></a>
  &nbsp;·&nbsp;
  <a href="#try-it-in-60-seconds">🚀 Install</a>
  &nbsp;·&nbsp;
  <a href="https://ashark-ai-05.github.io/opencanvas/api.html">📡 API reference</a>
  &nbsp;·&nbsp;
  <a href="./docs/plans/unified-agent.md">🏗 Architecture</a>
  &nbsp;·&nbsp;
  <a href="./SECURITY.md">🔒 Security</a>
</p>

</div>

---

## Why a canvas

Chat is a stream. The things you actually want from a model are not.

<p align="center">
  <img src="docs/why-canvas.svg" alt="Left: a chat transcript scrolling endlessly with the one useful line buried in it. Right: the same prompt on OpenCanvas, where a chart, a table and a kanban land side by side and the chat shrinks to one line." width="100%">
</p>

The model never prints the answer. It calls `place_widget` with a typed payload; a Zod schema checks it; tldraw draws it. Three things fall out of that one decision:

- **Answers become objects.** Drag them, pin them, link them, export them. They survive the next question.
- **The chat gets out of the way.** One line pointing at what was placed, not five paragraphs hiding it.
- **The canvas remembers.** Every widget and every conversation indexes into a local store; `⌘K` finds them again next week.

<details>
<summary><b>How it compares</b> to Claude Artifacts, ChatGPT Canvas and Cursor Composer</summary>
<br>

| | OpenCanvas | Claude Artifacts | ChatGPT Canvas | Cursor Composer |
|---|---|---|---|---|
| **Spatial canvas, many widgets per turn** | ✅ | ❌ one pane | ❌ document | ❌ one pane |
| **Bring your own model** | ✅ 6 providers incl. local Ollama | ❌ | ❌ | ⚠️ a few |
| **MCP-native** | ✅ any server, any model | ✅ | ❌ | ⚠️ |
| **Instant widgets without a model** | ✅ | ❌ | ❌ | ❌ |
| **Model registers new widget kinds at runtime** | ✅ | ❌ | ❌ | ❌ |
| **Open source, local-first** | ✅ MIT | ❌ | ❌ | ❌ |

</details>

---

## Try it in 60 seconds

```bash
git clone https://github.com/ashark-ai-05/opencanvas.git && cd opencanvas
pnpm install
cp .env.example .env       # add one provider key, or none for local-only
pnpm electron:dev          # backend + Vite + Electron
```

No Electron? `pnpm dev` and open http://127.0.0.1:3458. Public demo of your own: [docs/deploy-railway.md](./docs/deploy-railway.md).

**No API key? Start typing anyway.** Timers, checklists, reminders, events, notes, arithmetic and unit conversions are recognised as you type and placed on Enter, with no model call. Add [Ollama](https://ollama.com) for a fully offline agent on top.

<p align="center">
  <img src="docs/instant-widgets.svg" alt="Typing '25 min focus' into the composer. A chip previews 'Timer 25:00 · Focus', Enter places a live timer on the canvas, and a note reads 'Placed Timer 25:00 · Focus without the model' with an 'Ask the model instead' link." width="100%">
</p>

---

## Any model, same agent

| Provider | Key | Notes |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Claude Sonnet / Opus 4+, extended thinking on |
| OpenAI | `OPENAI_API_KEY` | GPT-4o, GPT-4.1, o-series |
| Google Gemini | `GOOGLE_API_KEY` | Gemini 2.5 / 3.x, thinking shown in chat |
| Groq | `GROQ_API_KEY` | Llama, Mixtral, Kimi at Groq speed |
| OpenRouter | `OPENROUTER_API_KEY` | One key, hundreds of models |
| Ollama | none | Anything you've pulled. Nothing leaves 127.0.0.1 |

Tool calling runs on the [Vercel AI SDK](https://ai-sdk.dev/); embeddings are bundled ONNX (offline), OpenAI, Voyage or Ollama. Switch models in Settings or in `~/.opencanvas/config.json`.

---

## What it places

**15 widget kinds**: markdown, code, tables, timelines, file trees, kanban, tasks, sticky notes, composite cards, Vega-Lite charts, calendars, clock / timer / stopwatch / pomodoro, sandboxed web embeds, plugin iframes, generic fallback. Each is a Zod schema plus a React component; add a kind, the model uses it from the tool description alone.

**Runtime plugins.** The model can call `register_widget_kind` mid-conversation and use the new kind from then on. A Pyodide Python REPL and a JS REPL ship as examples, ~200 lines each.

**Memory.** Every conversation indexes into a local SQLite + sqlite-vec store. `⌘K` searches widgets, chats and your indexed docs across every conversation.

---

## Plug in your world

**MCP.** Drop any server under `profiles[].sources`; it works with every provider and the tools appear as `mcp__<id>__<tool>`.

```jsonc
{ "sources": [{ "id": "dev-fs", "transport": "stdio", "command": "npx",
                "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Development"] }] }
```

**REST.** Anything on your machine can render widgets. The browser keeps an SSE stream open; a `POST` pushes a widget onto the canvas.

```bash
curl -X POST http://127.0.0.1:3457/v1/canvas/widgets \
  -H 'content-type: application/json' \
  -H "x-opencanvas-token: $(cat ~/.opencanvas/auth-token)" \
  -d '{"kind":"chart","role":"primary","payload":{"title":"Sales","spec":{...}}}'
```

Full OpenAPI 3.1 reference: [live docs](https://ashark-ai-05.github.io/opencanvas/api.html) or `http://127.0.0.1:3457/docs` while running.

---

## Built to be trusted

- Runs on `127.0.0.1`. No telemetry. No remote service unless you configure one.
- A 256-bit token (file mode `0600`) guards every state-changing route; CORS is locked to the app origin.
- Model-written HTML renders in `sandbox="allow-scripts"` iframes with a null origin: no cookies, no parent DOM, no localStorage.
- Electron ships with `contextIsolation`, `sandbox: true` and a strict CSP.

Threat model, including what is out of scope, in [SECURITY.md](./SECURITY.md).

---

## Develop

```bash
pnpm test                                      # backend, 397 tests
pnpm vitest run --config app/vite.config.ts    # frontend, 378 tests
pnpm typecheck && pnpm app:build && pnpm dist  # tsc, bundle, installers
```

Issues and PRs welcome, see [CONTRIBUTING.md](./CONTRIBUTING.md). Security reports go through [SECURITY.md](./SECURITY.md).

---

## What's new

- **Instant widgets, no model call.** Timers, checklists, reminders, events, notes, arithmetic and unit conversions are recognised as you type and placed on Enter in under 50 ms. Works offline and with no API key. A chip previews exactly what will land; ⌘↵ asks the model instead.
- **One agent for every provider.** Gemini, OpenAI, Groq, Ollama and OpenRouter get the same tool-calling agent Claude had. No more text-only wrappers.
- **Hardened.** better-sqlite3 13 (fixes a Node 24 crash), a swept dependency tree, secret scanning and protected release tags on the repo.

[Changelog](./CHANGELOG.md)

---

## License

[MIT](./LICENSE). Built on tldraw v3, Hono, better-sqlite3 + sqlite-vec and the Vercel AI SDK. The instant-widget state machine is adapted from [shapeshift](https://github.com/anishfn/shapeshift) (MIT) and runs entirely in the browser, with no hosted classifier.

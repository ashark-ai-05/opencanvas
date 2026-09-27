# OpenCanvas guide

Everything the front-page README leaves out. For contributing, see [CONTRIBUTING.md](../CONTRIBUTING.md); for the threat model, [SECURITY.md](../SECURITY.md).

## Contents

- [Run it](#run-it)
- [Pick a model](#pick-a-model)
- [Instant widgets (no model)](#instant-widgets-no-model)
- [Widget kinds](#widget-kinds)
- [Runtime plugins](#runtime-plugins)
- [MCP servers](#mcp-servers)
- [REST API](#rest-api)
- [Knowledge base](#knowledge-base)
- [Security in one screen](#security-in-one-screen)
- [Deploy a public demo](#deploy-a-public-demo)
- [Develop](#develop)

## Run it

```bash
git clone https://github.com/ashark-ai-05/opencanvas.git && cd opencanvas
pnpm install
cp .env.example .env       # one provider key, or none for local-only
pnpm electron:dev          # backend + Vite + Electron
```

Without Electron: `pnpm dev`, then open http://127.0.0.1:3458. The backend listens on `127.0.0.1:3457`.

Config lives in `~/.opencanvas/config.json` (written on first run). Profiles hold the LLM, the embedder and your MCP sources; switch the active profile or override provider, model and key from Settings in the app.

## Pick a model

Every provider gets the same tool-calling agent, the same widget catalog and the same UX.

| Provider | Env var | Notes |
|---|---|---|
| Anthropic | `ANTHROPIC_API_KEY` | Claude Sonnet / Opus 4+; extended thinking on automatically |
| OpenAI | `OPENAI_API_KEY` | GPT-4o, GPT-4.1, o-series |
| Google Gemini | `GOOGLE_API_KEY` | Gemini 2.5 / 3.x Flash and Pro; thinking shown in chat |
| Groq | `GROQ_API_KEY` | Llama, Mixtral, Kimi at Groq speed |
| OpenRouter | `OPENROUTER_API_KEY` | One key, hundreds of models |
| Ollama | none | Any model you've pulled; nothing leaves your machine |

Embedders: bundled ONNX (`BAAI/bge-small-en-v1.5`, offline, default), OpenAI, Voyage, Ollama.

<details>
<summary>Fully local config</summary>

```jsonc
// ~/.opencanvas/config.json
{
  "activeProfile": "local",
  "profiles": [{
    "name": "local",
    "llm":   { "provider": "ollama", "model": "llama3.1:8b" },
    "embed": { "provider": "ollama", "model": "nomic-embed-text" },
    "sources": []
  }]
}
```
</details>

The agent needs reliable function calling. Small local models vary; share what works for you in [Discussions](https://github.com/ashark-ai-05/opencanvas/discussions).

## Instant widgets (no model)

As you type, a local classifier plus deterministic parsers recognise utility prompts and show a chip previewing the widget. Enter places it through the same dispatcher the model uses, in under 50 ms, with no network call. ⌘/Ctrl+Enter sends the same text to the model instead. Tab promotes a faint (ghost) chip; Esc dismisses it.

| Intent | Try | Becomes |
|---|---|---|
| Timer | `25 min focus`, `pomodoro`, `1:30 timer` | live timer / pomodoro |
| Stopwatch | `stopwatch for the run` | live stopwatch |
| Clock | `time in tokyo`, `clock pst` | clock in that zone |
| Checklist | `buy milk, eggs, bread`, `todo: call bank; renew passport` | task list |
| Reminder | `remind me to pay rent friday` | task with due date |
| Event | `standup with priya tomorrow 10am on zoom` | event card (when / with / mode) |
| Note | `note: the api key rotates monthly` | sticky note |
| Calc | `18% of 3450`, `split 2400 between 3` | result card |
| Convert | `5 miles in km`, `72f to c` | result card |

Toggle it in Settings ("Instant widgets"). It is on by default locally and off on the public demo. Design notes: [plans/fast-lane-intent.md](./plans/fast-lane-intent.md).

## Widget kinds

Fifteen built in: markdown, code (Shiki), tables, timelines, file trees, kanban, tasks, sticky notes, composite cards, Vega-Lite charts, calendars, clock / timer / stopwatch / pomodoro, sandboxed web embeds, plugin iframes, and a generic fallback.

Each kind is a Zod schema (`src/agent/payloads.ts`) plus a React shape (`app/src/canvas/shapes/`). The model learns a new kind from its tool description alone; no retraining.

## Runtime plugins

The model can call `register_widget_kind` mid-conversation with a JSON Schema and an HTML template, and use the new kind from then on. Two examples ship: a Pyodide Python REPL and a JS REPL, about 200 lines each. Plugin iframes run with `sandbox="allow-scripts"` and no `allow-same-origin`, so they get a null origin and cannot reach the parent DOM, cookies or storage. Manage them from the Plugins panel.

## MCP servers

Add any MCP server under `profiles[].sources`. It works with every provider; tools surface as `mcp__<id>__<tool>`.

```jsonc
{
  "sources": [{
    "id": "dev-fs",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Development"]
  }]
}
```

Verify with `pnpm cli --probe-sources`. OpenCanvas also exposes its own MCP server (`pnpm mcp`) so other agents can drive the canvas.

## REST API

Any local process can render widgets. The browser holds an SSE connection to `/v1/canvas/events`; a `POST` pushes a directive onto the per-conversation event bus.

```bash
curl -X POST http://127.0.0.1:3457/v1/canvas/widgets \
  -H 'content-type: application/json' \
  -H "x-opencanvas-token: $(cat ~/.opencanvas/auth-token)" \
  -d '{"kind":"chart","role":"primary","payload":{"title":"Sales","spec":{...}}}'
```

Reference: [live docs](https://ashark-ai-05.github.io/opencanvas/api.html), the [OpenAPI 3.1 spec](./openapi.yaml), or `http://127.0.0.1:3457/docs` while running.

## Knowledge base

Every conversation auto-indexes into a local SQLite + sqlite-vec store alongside anything you index yourself. Retrieval is hybrid BM25 + vector; re-indexing unchanged content costs no model calls.

```bash
pnpm cli --index ./docs            # markdown / text
pnpm cli --index-code ./src        # tree-sitter chunks + symbols
pnpm cli --search "<query>"
```

`⌘K` searches widgets, conversations, the KB and slash commands from one palette.

## Security in one screen

- Everything binds to `127.0.0.1`. No telemetry. No remote service unless you configure one.
- A 256-bit token (`~/.opencanvas/auth-token`, mode `0600`) guards every state-changing route. CORS is locked to the app origin.
- Model-written HTML renders in null-origin sandboxed iframes.
- Electron: `contextIsolation`, `sandbox: true`, strict CSP.

Full threat model, including what is out of scope: [SECURITY.md](../SECURITY.md).

## Deploy a public demo

[deploy-railway.md](./deploy-railway.md): Railway plus a free-tier Gemini key, about ten minutes. Demo mode disables auth, opens CORS and rate-limits chat per IP. Uptime monitoring notes: [operations/uptime-monitoring.md](./operations/uptime-monitoring.md).

## Develop

```bash
pnpm test                                      # backend (vitest, Node)
pnpm vitest run --config app/vite.config.ts    # frontend (vitest + jsdom)
pnpm typecheck                                 # tsc --noEmit
pnpm app:build                                 # production bundle
pnpm dist                                      # electron-builder installers
```

CI runs typecheck, both suites and a production dependency audit on every push. Architecture: [plans/unified-agent.md](./plans/unified-agent.md). Contributing: [CONTRIBUTING.md](../CONTRIBUTING.md).

<div align="center">

<img src="build/icons/icon-256.png" alt="OpenCanvas" width="128" height="128" />

# OpenCanvas

### Stop reading AI replies. Watch them assemble on an infinite canvas.

Your LLM doesn't print markdown. It **places typed widgets** on a tldraw canvas: charts, diagrams, code, kanbans, tables, custom HTML. It **learns your patterns** and registers reusable widget templates as it goes. Any model with function calling. Bring your own key.

**BYO model · MCP-native · Self-improving · Local-first · MIT**

[![ci](https://github.com/ashark-ai-05/opencanvas/actions/workflows/ci.yml/badge.svg)](https://github.com/ashark-ai-05/opencanvas/actions/workflows/ci.yml) [![tests](https://img.shields.io/badge/tests-610%20passing-2dd4bf)]() [![tsc](https://img.shields.io/badge/tsc-clean-a78bfa)]() [![license](https://img.shields.io/badge/license-MIT-fbbf24)](./LICENSE) [![security](https://img.shields.io/badge/security-policy-22c55e)](./SECURITY.md)

![demo](docs/demo.gif)

<p>
  <a href="https://opencanvas-production.up.railway.app"><b>▶︎ Try the live demo</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ashark-ai-05/opencanvas">⭐ Star on GitHub</a>
  &nbsp;·&nbsp;
  <a href="https://ashark-ai-05.github.io/opencanvas/api.html">📡 API reference</a>
  &nbsp;·&nbsp;
  <a href="./docs/plans/unified-agent.md">🏗 Architecture</a>
</p>

**[Install](#install) · [Why](#why-opencanvas) · [Models](#pick-any-llm) · [Widgets](#the-widget-catalog) · [REST API](#drive-it-from-any-process) · [Security](./SECURITY.md)**

</div>

---

## Why OpenCanvas

Chat apps give you a scrolling wall of text. OpenCanvas gives the model a **canvas** and a **toolbox**.

Ask for a sales breakdown and you get a Vega-Lite chart next to a kanban of follow-ups next to the SQL that produced it. Drag them around. Pin the ones you keep. Every widget is a typed contract, so the model can't hand you broken output, and every conversation lands in a searchable local knowledge base.

| | OpenCanvas | Claude Artifacts | Cursor Composer | v0 (Vercel) | ChatGPT Canvas |
|---|---|---|---|---|---|
| **Spatial canvas** | ✅ tldraw infinite canvas | ❌ single pane | ❌ single pane | ❌ single pane | ⚠️ document only |
| **Many typed widgets per turn** | ✅ chart · kanban · code · mermaid · HTML · … | ⚠️ one at a time | ❌ | ⚠️ one at a time | ❌ |
| **Bring your own model** | ✅ Anthropic / OpenAI / Google / Groq / Ollama / OpenRouter | ❌ Claude only | ⚠️ a few | ❌ hosted | ❌ OpenAI only |
| **MCP-native** | ✅ first-class | ✅ via Claude.ai | ⚠️ recent | ❌ | ❌ |
| **Self-improving widgets** | ✅ extracts templates from its own renders | ❌ | ❌ | ❌ | ❌ |
| **Open source, self-hosted** | ✅ MIT | ❌ | ❌ | ❌ | ❌ |
| **Fully local option** | ✅ Ollama + bundled ONNX embeddings | ❌ | ⚠️ partial | ❌ | ❌ |

Under the hood, that translates to:

| | Most chat apps | **OpenCanvas** |
|---|---|---|
| **Output** | A stream of text | Typed widgets you click, drag, pin, link, export |
| **Memory** | One context window | SQLite + sqlite-vec KB; every chat searchable across conversations |
| **Tools** | A handful, baked in | 15 widget kinds, 12 agent tools, your MCP servers, runtime plugins |
| **Drive it** | Chat box only | REST API: any local process can render widgets |
| **Privacy** | Cloud round-trips | Single user, BYO credentials, runs on your machine |

---

## Install

```bash
git clone https://github.com/ashark-ai-05/opencanvas.git
cd opencanvas
pnpm install
cp .env.example .env       # at least one provider key
pnpm electron:dev          # backend + Vite + Electron, one command
```

Headless without Electron: `pnpm dev`, then open http://127.0.0.1:3458.

Packaged installers (`.dmg` / `.exe` / `.AppImage`) ship on the [Releases tab](https://github.com/ashark-ai-05/opencanvas/releases). Want a public demo of your own? [docs/deploy-railway.md](./docs/deploy-railway.md) gets you there in about ten minutes.

---

## Pick any LLM

Every provider gets the **same agent**: same tools, same widget surface, same UX. The model is a config switch.

| Provider | Auth | Notes |
|---|---|---|
| **Anthropic** | `ANTHROPIC_API_KEY` | Claude Sonnet / Opus 4+; extended thinking auto-on |
| **OpenAI** | `OPENAI_API_KEY` | GPT-4o, GPT-4.1, o-series |
| **Google Gemini** | `GOOGLE_API_KEY` | Gemini 2.5 / 3.x Flash and Pro; thinking shows in chat |
| **Groq** | `GROQ_API_KEY` | Llama / Mixtral / Kimi at Groq speeds |
| **OpenRouter** | `OPENROUTER_API_KEY` | One key, hundreds of models |
| **Ollama** | none, local | Any model you've pulled (`llama3.2`, `qwen2.5-coder`, …) |
| **Sourcegraph Amp** | `AMP_API_KEY` | Hosted agent loop (legacy path) |

Tool calling runs on the [Vercel AI SDK](https://ai-sdk.dev/), so any provider with function-calling support behaves the same. Embedders are pluggable too: bundled ONNX (offline), OpenAI, Voyage, or Ollama. Architecture notes live in [`docs/plans/unified-agent.md`](./docs/plans/unified-agent.md).

<details>
<summary>Fully local config example</summary>

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

---

## The widget catalog

**15 kinds.** Markdown · code · tables · timelines · file trees · kanban · tasks · sticky notes · composite cards · charts (Vega-Lite) · calendars · clock / timer / stopwatch / pomodoro · web embeds (sandboxed iframes) · plugin iframes · generic fallback.

Every widget is a **typed contract**: a Zod schema for props plus a React component. Add a new kind without retraining anything.

**Runtime plugins.** The agent can call `register_widget_kind` mid-conversation to declare a brand-new widget on the fly. A Python REPL (Pyodide) and a JS REPL ship as examples. Plugin iframes run with `sandbox="allow-scripts"` and no `allow-same-origin`: null origin, no access to the parent DOM.

---

## MCP-native

Add any MCP server under `profiles[].sources`. Works with every provider.

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

Verify with `pnpm cli --probe-sources`. The agent calls them as `mcp__dev-fs__<tool>`.

---

## Drive it from any process

Cron jobs, file watchers, shell scripts: anything on your machine can render widgets. The browser holds an SSE connection to `/v1/canvas/events`; external `POST`s push directives onto the per-conversation event bus.

```bash
# Place a Vega-Lite chart from your terminal
curl -X POST http://127.0.0.1:3457/v1/canvas/widgets \
  -H 'content-type: application/json' \
  -H "x-opencanvas-token: $(cat ~/.opencanvas/auth-token)" \
  -d '{"kind":"chart","role":"primary","payload":{"title":"Sales","spec":{...}}}'
```

**REST reference.** Browse the [live API docs](https://ashark-ai-05.github.io/opencanvas/api.html) or read the [OpenAPI 3.1 spec](./docs/openapi.yaml). A running backend serves the same UI at `http://127.0.0.1:3457/docs`.

**Auth.** A 256-bit token is generated on first run and stored at `~/.opencanvas/auth-token` (mode `0600`). Required on every state-mutating route. Details in [SECURITY.md](./SECURITY.md).

---

## Self-improving knowledge base

Every conversation auto-indexes into the same SQLite + sqlite-vec store as your docs and code. Old turns become searchable through `search_kb`. Retrieval is hybrid BM25 + vector. Re-indexing is idempotent: unchanged content costs zero LLM calls.

```bash
pnpm cli --index ./docs            # markdown / text → chunks + embeddings
pnpm cli --index-code ./src        # tree-sitter chunks + symbols
pnpm cli --search "<query>"        # hybrid search
```

The agent also learns *you*. Widget kinds you keep and pin score higher next time; kinds you dismiss get placed less. Per conversation, stored locally, no remote tracking.

---

## Architecture

```
┌────────────────────┐                ┌─────────────────────────┐
│  Vite + React +    │   /v1/chat     │  Hono backend           │
│  tldraw            │ ─────────────→ │                         │
│  • floating chat   │                │  provider adapters      │
│  • canvas          │                │  12 in-process tools    │
│  • palette ⌘K      │ ←── SSE ────── │  + external MCP servers │
│  • history         │  /v1/canvas/   │  + plugin registry      │
└────────────────────┘    events      │       │                 │
                                      │       ▼                 │
                                      │  SQLite + sqlite-vec    │
                                      └─────────────────────────┘
```

tldraw v3 with one shape util per widget kind. Zustand for app state. AI SDK for chat streaming. Hono + better-sqlite3 + sqlite-vec on the backend. Electron wrapper for the desktop build.

---

## Development

```bash
pnpm test                                          # backend (vitest, Node)
pnpm vitest run --config app/vite.config.ts        # frontend (vitest + jsdom)
pnpm typecheck                                     # tsc --noEmit
pnpm app:build                                     # production bundle
pnpm dist                                          # electron-builder installer
```

**610 tests**: 396 backend, 214 frontend. CI runs both suites plus a production dependency audit on every push.

---

## Status

Experimental. Solo project, MIT. No telemetry, no remote services unless you point it at one.

Issues and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). Security reports go through [SECURITY.md](./SECURITY.md).

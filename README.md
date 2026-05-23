<div align="center">

<img src="build/icons/icon-256.png" alt="OpenCanvas" width="128" height="128" />

# OpenCanvas

### An infinite canvas your LLM draws on.

Ask anything. The agent renders **typed widgets** on a tldraw canvas — markdown, charts, kanbans, code, tables, web embeds, sandboxed plugins. Every conversation indexes back into a local SQLite KB so the canvas gets smarter with use.

**BYO model · MCP-native · Local-first · MIT**

[![ci](https://github.com/ashark-ai-05/opencanvas/actions/workflows/ci.yml/badge.svg)](https://github.com/ashark-ai-05/opencanvas/actions/workflows/ci.yml) [![tests](https://img.shields.io/badge/tests-596%20passing-2dd4bf)]() [![tsc](https://img.shields.io/badge/tsc-clean-a78bfa)]() [![license](https://img.shields.io/badge/license-MIT-fbbf24)](./LICENSE) [![security](https://img.shields.io/badge/audit-clean-22c55e)](./SECURITY.md)

![demo](docs/demo.gif)

[Watch the 1-minute walkthrough →](docs/demo.mp4)

**[Install](#install) · [Why it's different](#why-its-different) · [Pick any LLM](#pick-any-llm) · [Drive it from any process](#drive-it-from-any-process) · [Security model](./SECURITY.md)**

</div>

---

## Install

```bash
git clone https://github.com/ashark-ai-05/opencanvas.git
cd opencanvas
pnpm install
cp .env.example .env       # at least one provider key
pnpm electron:dev          # full stack: backend + Vite + Electron
```

Headless without Electron: `pnpm dev` → http://127.0.0.1:3458

> Packaged installers (`.dmg` / `.exe` / `.AppImage`) ship via the [Releases tab](https://github.com/ashark-ai-05/opencanvas/releases).

---

## Why it's different

|   | Most chat apps | **OpenCanvas** |
|---|---|---|
| **Output** | A long stream of text | Typed widgets on a canvas — click, drag, pin, link, export |
| **Memory** | Per-message context window | Self-improving SQLite KB; every chat is searchable across conversations |
| **Tools** | A handful, baked in | 15 widget kinds + 12 agent tools + your MCP servers + runtime plugins |
| **Sources** | Chat-only | MCP-native — any server (Confluence, Jira, filesystem, GitHub, …) |
| **Drive** | Chat input only | REST API — any local process can render widgets via `POST /v1/canvas/*` |
| **Privacy** | Cloud round-trips | Single-user, BYO credentials, runs entirely on your machine |

---

## Pick any LLM

Six provider adapters ship out of the box. Set the env var or edit `~/.opencanvas/config.json`:

| Provider | Auth | Notes |
|---|---|---|
| **Claude (Agent SDK)** | OAuth via Claude Code, or `ANTHROPIC_API_KEY` | In-process MCP — fastest agent loop |
| **Anthropic direct** | `ANTHROPIC_API_KEY` | Plain API; any Claude model |
| **OpenAI** | `OPENAI_API_KEY` | GPT-4o, GPT-4.1, etc. |
| **OpenRouter** | `OPENROUTER_API_KEY` | One key, hundreds of models |
| **Ollama** | _none — local_ | Any model you've pulled (`llama3`, `qwen2.5-coder`, …) |
| **Sourcegraph Amp** | `AMP_API_KEY` | Hosted agent loop |

Embedders are pluggable too: bundled ONNX (runs offline), OpenAI, Voyage, or Ollama.

<details>
<summary>Fully-local config example</summary>

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

**15 kinds.** Markdown · code blocks · tables · timelines · file trees · kanban · tasks · sticky notes · composite cards · charts (Vega-Lite) · calendars · clock/timer/stopwatch/pomodoro · web embeds (sandboxed iframes) · plugin-rendered iframes · generic fallback.

All draggable, resizable, role-tinted, exportable. Every widget is a **typed contract** — Zod schema for props + a React component. Add a new kind without retraining anything.

**Runtime plugins.** The agent can call `register_widget_kind` mid-conversation to declare a new widget on the fly. Ships with a Python REPL (Pyodide) and a JS REPL example. Plugin iframes run with `sandbox="allow-scripts"`, no `allow-same-origin` — null origin, no parent DOM access.

---

## MCP-native

Add any MCP server under `profiles[].sources`. Works with any LLM provider:

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

`pnpm cli --probe-sources` to verify. The agent invokes them as `mcp__dev-fs__<tool>`.

---

## Drive it from any process

Any local process — cron jobs, watchers, scripts — can render widgets on a running OpenCanvas. The browser keeps an SSE connection open to `/v1/canvas/events`; external `POST`s push directives into the per-conversation event bus.

```bash
# Place a Vega-Lite chart from your terminal
curl -X POST http://127.0.0.1:3457/v1/canvas/widgets \
  -H 'content-type: application/json' \
  -H "x-opencanvas-token: $(cat ~/.opencanvas/auth-token)" \
  -d '{"kind":"chart","role":"primary","payload":{"title":"Sales","spec":{...}}}'
```

The full REST surface (~30 endpoints — `POST /v1/canvas/widgets`, `PATCH /v1/canvas/widgets/:id`, streaming, plugin registry, …) is documented at `/docs` (Swagger UI) when the backend is running.

**Auth.** A 256-bit token is generated on first run and persisted to `~/.opencanvas/auth-token` (mode `0600`). Required on state-mutating routes. See [SECURITY.md](./SECURITY.md).

---

## Self-improving KB

Every conversation auto-indexes into the same SQLite + sqlite-vec store as your docs and code. Old turns become searchable via `search_kb`. Hybrid BM25 + vector retrieval (RRF, k=60). Idempotent re-indexing — re-running on unchanged content costs zero LLM calls.

```bash
pnpm cli --index ./docs            # markdown / text → chunks + embeddings
pnpm cli --index-code ./src        # tree-sitter chunks + symbols
pnpm cli --search "<query>"        # hybrid search
```

The agent also learns *you* — kinds you keep + pin score higher; kinds you dismiss bias the next placement away. Per-conversation, persisted locally, no remote tracking.

---

## Architecture in one diagram

```
┌────────────────────┐                ┌─────────────────────────┐
│  Vite + React +    │   /v1/chat     │  Hono backend           │
│  tldraw            │ ─────────────→ │  (provider abstraction) │
│  • floating chat   │                │                         │
│  • canvas          │                │  6 LLM adapters         │
│  • palette ⌘K      │                │  12 in-process tools    │
│  • history         │ ←── SSE ────── │  + external MCP servers │
│                    │  /v1/canvas/   │  + plugin registry      │
└────────────────────┘    events      │       │                 │
                                      │       ▼                 │
                                      │  SQLite + sqlite-vec    │
                                      └─────────────────────────┘
```

Frontend uses tldraw v3 with custom shape utils for each widget. Zustand for app state, AI SDK 6 for chat streaming. Backend is Hono + better-sqlite3 + sqlite-vec. Electron wrapper for the desktop install.

---

## Development

```bash
pnpm test                                          # backend (vitest, Node)
pnpm vitest run --config app/vite.config.ts        # frontend (vitest + jsdom)
pnpm typecheck                                     # tsc --noEmit
pnpm app:build                                     # production bundle
pnpm dist                                          # electron-builder installer
```

**596 tests passing** — 383 backend, 213 frontend.

---

## Status

Experimental. Solo project, MIT, no telemetry, no remote services unless you point it at one.

Issues and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md). For security issues, [SECURITY.md](./SECURITY.md).

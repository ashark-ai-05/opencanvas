# OpenCanvas

> A local desktop knowledge surface — ask anything, an agent reshapes a canvas of cited widgets to answer.

![demo](docs/demo.gif)

OpenCanvas is a single-user, BYO-credentials desktop app. You ask a question; an agent searches your indexed knowledge (docs, code, prior conversations), the web, and any MCP server you wire up; then it **places typed widgets on an infinite tldraw canvas** — markdown, code blocks, tables, timelines, file trees, kanban boards, sticky notes, composite cards — and replies with a short note pointing to what it built. Every conversation indexes back into the same store, so the canvas gets smarter with use.

It runs entirely on your machine. The only outbound calls are to the LLM provider you choose, the embedder if you don't use the bundled one, Tavily for web search, and any MCP servers you configure.

---

## What's interesting

- **Self-improving KB** — every conversation auto-indexes into the same SQLite store as your docs/code; `search_kb` finds prior chats. The system gets smarter as you use it.
- **Multi-agent `/team`** — three agents pass a baton: Researcher gathers evidence, Builder synthesizes, Critic flags gaps. Each phase sees the canvas the prior phase built.
- **Native canvas, not chat-text** — answers materialize as 12 typed widget kinds. All draggable, resizable, collapsible, role-tinted.
- **MCP-native** — any MCP server in your config (filesystem, Confluence, Jira, …) is exposed to the agent automatically as `mcp__<source-id>__<tool>`.
- **Per-conversation canvas** — switch threads via the History panel; canvas + chat swap atomically.
- **Live progress in-input** — every chat turn shows the active step (📚 searching KB · 🌐 web · 🎨 placing widget · ✍️ writing) right where you're typing.
- **Mini-map + sources panel** — bottom-left thumbnail of the canvas, drawer listing every indexed source.

---

## Quick start

```bash
pnpm install
cp .env.example .env       # fill in keys you want (Anthropic / OpenAI / Tavily / Jira / …)
pnpm cli --probe           # health-check provider + embedder
pnpm electron:dev          # open the desktop app (backend + Vite + Electron, all in one)
```

Or run headless without Electron and open in a browser:

```bash
pnpm dev                   # backend on :3457, app on :3458 → http://127.0.0.1:3458
```

### LLM auth

Default profile uses the **Claude Agent SDK** with OAuth via your existing Claude Code login — no API key needed if you already use Claude Code interactively. Otherwise set `ANTHROPIC_API_KEY` in `.env`.

Other providers (OpenAI, OpenRouter, Ollama, Anthropic direct, Sourcegraph Amp) are available via config; see `.env.example` for the keys.

### Web search

Set `TAVILY_API_KEY` in `.env` (free tier: 1000 searches/month at <https://app.tavily.com>). Without it, `web_search` returns an explicit "not configured" error rather than silently failing.

### MCP sources

Add servers under `profiles[].sources` in `~/.opencanvas/config.json`:

```jsonc
{
  "activeProfile": "claude-sdk",
  "profiles": [{
    "name": "claude-sdk",
    "llm": { "provider": "claude-agent-sdk" },
    "sources": [{
      "id": "dev-filesystem",
      "name": "Development directory",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/Development"]
    }]
  }]
}
```

Verify with `pnpm cli --probe-sources`. Then chat — the agent calls them as `mcp__dev-filesystem__<tool>`.

---

## Slash commands

Type `/` in chat to see the popover.

| Command | Effect |
| --- | --- |
| `/team <prompt>` | Run the Researcher → Builder → Critic pipeline |
| `/clear` | Start a new conversation (current one stays in History) |
| `/template <id>` | Switch active canvas template (`ask-anything`, `tell-me-about-x`, `whats-new-since-y`, `trace-x-everywhere`) |
| `/help` | List every command |

---

## Indexing your knowledge

Two CLI commands populate the SQLite KB directly (handy for one-off doc folders):

```bash
pnpm cli --index ./docs            # markdown / text → chunked + embedded
pnpm cli --index-code ./src        # .ts/.tsx/.js/.jsx → tree-sitter chunks + symbols
pnpm cli --search "<query>"        # hybrid BM25 + vector search across everything
pnpm cli --storage-status          # path + size + table row counts
```

For richer multi-source projects (code + Jira + Confluence + Stash):

```bash
pnpm cli --kb-init my-svc --kb-root /path/to/repo
# then edit ~/.opencanvas/config.json knowledgeBase.projects[] to add jira/confluence/stash
pnpm cli --kb-ingest my-svc        # auto-enriches each chunk with 12 hypothetical user queries
pnpm cli --kb-status my-svc        # cursor + counts per source + per link type
```

Re-indexing is **idempotent** — re-running on unchanged content does zero LLM calls (the QA enricher caches per-chunk via sha256 hash).

Conversations index back into the same store automatically after every assistant turn — no command needed.

---

## Architecture

```
┌────────────────────────┐                ┌─────────────────────────┐
│  Vite + React + tldraw │   /v1/chat     │  Hono backend           │
│  app on :3458          │ ─────────────→ │  (provider abstraction) │
│                        │   /v1/team     │                         │
│  • Floating chat       │ ─────────────→ │  ClaudeAgentSdkAdapter  │
│  • tldraw canvas       │                │       │                 │
│  • Conversations       │                │       ▼                 │
│  • Sources panel       │                │  Claude Agent SDK       │
│  • Mini-map            │ ←─── UIMS ──── │  (in-process MCP)       │
│                        │                │       │                 │
└────────────────────────┘                │       ▼                 │
                                          │  11 in-process tools    │
                                          │  + external MCP servers │
                                          │       │                 │
                                          │       ▼                 │
                                          │  SQLite + sqlite-vec    │
                                          │  (chunks + embeddings)  │
                                          └─────────────────────────┘
```

**Backend** (`src/`): Hono routes (`/v1/chat`, `/v1/team`, `/v1/search`, `/v1/index-conversation`, `/v1/sources/list`, `/v1/health`, …). Provider abstraction (`LLMProvider` interface) supports Claude Agent SDK, OpenAI, OpenRouter, Ollama, Anthropic direct, Sourcegraph Amp. `SearchService` is hybrid BM25 + sqlite-vec with reciprocal rank fusion (k=60). KB pipeline owns chunking + QA enrichment + per-project source state.

**Frontend** (`app/`): tldraw 3 with custom shape utils for each widget kind. Zustand stores for conversations, templates, canvas stats, UI flags. AI SDK 6 `useChat` for chat streaming over the UI Message Stream protocol; live tool events drive the canvas dispatcher.

**12 widget kinds**: `markdown`, `code-block`, `ticket`, `web-embed`, `key-value-card`, `table`, `timeline`, `file-tree`, `composite`, `tasks`, `kanban`, `sticky-note`.

**11 agent tools** (in-process MCP): `search_kb`, `fetch_result`, `web_search`, `place_widget`, `update_widget`, `read_canvas`, `read_widget`, `focus_widget`, `link_widgets`, `clear_canvas`, `switch_template`. External MCP servers add their own (`mcp__<source-id>__<tool>`).

---

## Development

```bash
pnpm test                                          # backend (vitest, Node)
pnpm exec vitest run --config app/vite.config.ts   # frontend (vitest + jsdom)
pnpm typecheck                                     # tsc --noEmit (root)
pnpm exec tsc --noEmit -p app/tsconfig.json        # tsc (app)

pnpm dev                                           # backend + Vite (no Electron)
pnpm electron:dev                                  # backend + Vite + Electron desktop window
pnpm dist:linux                                    # build installer (mac / win / linux)
```

The dev backend uses `tsx` (no watcher). To pick up backend changes you need to restart `pnpm dev`. Vite HMRs the frontend.

### Project layout

```
src/                                # backend (Node, ESM)
  agent/                            # tools/, payloads.ts, types.ts, canvas-snapshot.ts
  backend/                          # Hono app + routes/
  config/                           # ~/.opencanvas/config.json loader + zod schema
  connectors/                       # code, jira, stash, confluence
  embedders/                        # bundled-onnx, openai, voyage, ollama
  indexer/                          # orchestrator, chunker, qa-enricher, link-extractor
  kb/                               # cli-commands, export
  mcp/                              # transport, source registry
  providers/                        # claude-agent-sdk, anthropic-direct, openai, …
  search/                           # FTS5 + sqlite-vec hybrid + RRF
  storage/                          # SQLite open + migrations
  walk/                             # source-files
  web/                              # tavily

app/                                # frontend (Vite + React 19 + tldraw 3)
  src/
    canvas/                         # Tldraw setup + 13 shape utils + dispatcher
    components/                     # Chat, FloatingChat, KbHits, ComposerStatus, …
    state/                          # zustand stores
    styles/globals.css              # design tokens + chrome

electron/main.cjs                   # Electron wrapper
docs/                               # historical specs / demo gif
```

---

## Status

Experimental. Single-user, BYO credentials, runs entirely on your machine. The only outbound network calls are to your chosen LLM provider, the embedder if you use OpenAI / Voyage, Tavily for web search, and any MCP servers you configure.

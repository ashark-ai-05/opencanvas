# llm-wiki — LLM Provider Vertical Slice

A config-driven LLM provider layer for the llm-wiki project. This slice proves the architecture end-to-end: a single config file selects which LLM provider to use, and you can swap providers without touching any code.

For the full design intent, see [`docs/superpowers/specs/2026-05-02-llm-wiki-design.md`](docs/superpowers/specs/2026-05-02-llm-wiki-design.md) and its [amendments](docs/superpowers/specs/2026-05-02-llm-wiki-design-amendments.md).

---

## Prerequisites

- **Node.js 24+** — `node --version` should show v24 or later
- **pnpm** — `npm install -g pnpm` if missing
- **Claude Code installed** — required for the OAuth path (claude-agent-sdk provider)
- **Optional API keys** — needed only if you use non-OAuth providers (see `.env.example`)

---

## Install

```bash
pnpm install
```

---

## Configure

The config lives at `~/.llm-wiki/config.json` by default. Running any CLI command will auto-create a starter config on first run.

Override the path via `$LLM_WIKI_CONFIG`:

```bash
LLM_WIKI_CONFIG=/path/to/my/config.json pnpm cli --list-profiles
```

### Example config

```json
{
  "activeProfile": "claude-sdk",
  "profiles": [
    {
      "name": "claude-sdk",
      "llm": { "provider": "claude-agent-sdk" }
    },
    {
      "name": "openai-gpt4o",
      "llm": { "provider": "openai", "model": "gpt-4o" }
    },
    {
      "name": "local-llama",
      "llm": { "provider": "ollama", "model": "llama3.2" }
    },
    {
      "name": "openrouter-sonnet",
      "llm": {
        "provider": "openrouter",
        "model": "anthropic/claude-3-5-sonnet",
        "baseUrl": "https://openrouter.ai/api/v1"
      }
    }
  ]
}
```

---

## Run

### Stream a response

```bash
pnpm cli "What is 2+2?"
pnpm cli --profile openai-gpt4o "Explain async generators in TypeScript"
```

Expected output: the response streams to stdout as it arrives. Usage stats (token counts) print to stderr at the end.

### Health-check a provider

```bash
pnpm cli --probe                        # active profile
pnpm cli --profile local-llama --probe  # specific profile
```

### List profiles

```bash
pnpm cli --list-profiles
```

---

## Available providers

| Provider | Kind | Auth | Notes |
|---|---|---|---|
| `claude-agent-sdk` | agent | OAuth (Claude.ai) **or** `ANTHROPIC_API_KEY` | Recommended home profile. Uses the same engine as Claude Code. No API key needed if you have a Claude.ai Pro/Max subscription. |
| `anthropic-direct` | model | `ANTHROPIC_API_KEY` | Direct Anthropic API with extended thinking. No OAuth (per ToS). |
| `openai` | model | `OPENAI_API_KEY` | OpenAI chat completions. Default model: `gpt-4o`. |
| `openrouter` | model | `OPENROUTER_API_KEY` | OpenAI-compatible routing layer. Configurable model string. |
| `ollama` | model | none | Local models via Ollama. Requires `ollama serve`. Default model: `llama3.2`. |
| `amp` | agent | `AMP_API_KEY` | Sourcegraph Amp — stub, real wiring deferred to spike completion. |

### Setting API keys

Copy `.env.example` to `.env` and fill in the keys you need:

```bash
cp .env.example .env
# edit .env with your keys
```

Then load them before running:

```bash
source .env && pnpm cli "Hello"
# or use dotenv-cli: npx dotenv -e .env pnpm cli "Hello"
```

---

## Tests

```bash
pnpm test          # run all tests once
pnpm test:watch    # watch mode
pnpm typecheck     # TypeScript type check only
```

Tests are unit-only — no live API calls. The `FakeProvider` in `__tests__/provider.test.ts` verifies the interface contract without touching any external service.

---

## What's next

This is the LLM provider vertical slice (Plan 1'). The full Plan 1 (Foundation) adds:

- SQLite storage, embedding pipeline, and chunker
- Space-agent hybrid base
- MCP server integration
- Agent loop (Plan 5): tool-calling wired into model-kind providers
- Amp real wiring (post spike 01+02)

See the [design spec](docs/superpowers/specs/2026-05-02-llm-wiki-design.md) for the full roadmap.

---

## Storage

Local index lives at `~/.llm-wiki/index.sqlite` (single file, WAL mode, sqlite-vec extension loaded). Tables created from `src/storage/migrations/001_initial.sql` cover: `chunks`, `embeddings` (sqlite-vec), `fts` (FTS5), `symbols`, `links`, `prompt_cache`, `result_cache`, `sync_state`.

Inspect status:

```bash
pnpm cli --storage-status
```

The store is created on first invocation; subsequent runs reuse it.

---

## Embedders

Default: bundled ONNX (`bge-small-en-v1.5`, 384-dim). First run downloads ~130MB to the HuggingFace cache (`~/.cache/huggingface/`); subsequent runs are offline.

Available providers (set in `~/.llm-wiki/config.json` under `profiles[].embed`):

| Provider | Auth | Default model | Dims |
| --- | --- | --- | --- |
| `onnx-bundled` | none (offline) | `BAAI/bge-small-en-v1.5` | 384 |
| `openai` | `OPENAI_API_KEY` | `text-embedding-3-small` | 1536 |
| `voyage` | `VOYAGE_API_KEY` | `voyage-3` | 1024 |
| `ollama` | none (local Ollama) | `nomic-embed-text` | 768 |

Test the active embedder:

```bash
pnpm cli --embed "the quick brown fox"
```

Probe both LLM and embed in one command:

```bash
pnpm cli --probe
```

### Cold-start mitigation

The bundled ONNX embedder takes ~4.5s on first call (M-series CPU; spike 03 measurements). Per design amendment 3, future Plan 1.5 will pre-warm the embedder on app launch so users never see this latency interactively.

---

## Running the desktop app shell

The desktop app is built on a vendored copy of [space-agent](https://github.com/agent0ai/space-agent), pinned to commit `9c26f9f`. It is cloned into `vendor/space-agent/` (gitignored) on first setup, with our extensions mounted from `customware/`.

### First-time setup

```bash
pnpm setup
```

This clones space-agent (~150 packages, ~30s), pins it to the recorded SHA, runs `npm install` inside it, and creates a default admin user (username `admin`, password `change-me-now`).

The script is idempotent — re-running is safe.

### Boot

```bash
pnpm dev
```

This starts space-agent on http://127.0.0.1:3456 with `CUSTOMWARE_PATH` pointing at our `customware/` directory. Override the port with `PORT=3457 pnpm dev`.

Log in as `admin` / `change-me-now`. You should see a yellow banner at the bottom of the main dashboard view confirming our extension layer is loaded. The banner is injected via the `_core/dashboard/content_end` seam.

### Smoke check (no UI)

```bash
pnpm dev:check
```

Boots the server, makes one HTTP request, and exits 0 on success. Used by CI.

### What's wired in v1.5

- Vendored space-agent at a pinned upstream commit (`9c26f9f`)
- `customware/` directory mounted via `CUSTOMWARE_PATH`
- One proof-of-wire HTML extension (dashboard banner at `_core/dashboard/content_end`)

### What's NOT wired yet (Plan 1.6 and later)

- LLM provider integration — chat currently uses space-agent's defaults, not our `LLMProvider` adapter
- Embedder pre-warm on launch
- Profile config bridge (our `~/.llm-wiki/config.json` does not yet flow into space-agent's chat surface)
- MCP source connectors (Plan 2)
- Widgets and canvas templates (Plans 5–7)

### Updating the pinned commit

Edit `PINNED_SHA` in `scripts/setup-space-agent.sh`, run `pnpm setup`, then `pnpm dev:check` to verify boot still works. Per Spike 05, upstream churn is concentrated in areas we don't extend (Electron host, login UI, agent chat), so pin updates should be low-friction. Commit the pin update with the SHA in the message.

---

## MCP Sources

Configure MCP servers in `~/.llm-wiki/config.json` under `profiles[].sources`. Three transports are supported: `stdio` (subprocess), `sse` (Server-Sent Events), and `http` (Streamable HTTP).

### Example: filesystem MCP

```jsonc
{
  "activeProfile": "claude-sdk",
  "profiles": [
    {
      "name": "claude-sdk",
      "llm": { "provider": "claude-agent-sdk" },
      "embed": { "provider": "onnx-bundled", "model": "BAAI/bge-small-en-v1.5" },
      "sources": [
        {
          "id": "workspace-fs",
          "name": "Workspace Files",
          "transport": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/code"]
        }
      ]
    }
  ]
}
```

### CLI commands

```bash
# List configured sources for the active profile
pnpm cli --list-sources

# Connect every source and print health + tool count
pnpm cli --probe-sources

# Print the tool catalog for one source
pnpm cli --list-tools workspace-fs

# Call a tool directly
pnpm cli --call-tool workspace-fs read_file '{"path": "/Users/me/code/README.md"}'
```

### Roadmap

- v2 (this plan): connect/list/call. Raw tool surface.
- v3 (Plan 3): typed `Capability` verbs (`search` / `fetch` / `list` / `subscribe`) mapped onto MCP tools, with optional `source-manifest.json` hints.
- v3+ (Plan 5): MCP results materialised as typed `Result<K>` and routed through the agent loop.

---

## Running the backend

The backend exposes our LLM provider, embedder, and MCP source registry over HTTP so space-agent's customware can route through them.

### Ports and env

- Default port: `3457`. Override with `LLM_WIKI_BACKEND_PORT=3458 pnpm backend`.
- Default URL for customware: `http://127.0.0.1:3457`. Override with `LLM_WIKI_BACKEND_URL=...` when launching space-agent.

### Smoke check

```bash
pnpm backend:check
```

Boots, hits `/v1/health`, exits 0 on success. Used by CI.

### Endpoints

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/v1/health` | — | `{ ok, profile, llm, embedder }` |
| POST | `/v1/query` | `{ prompt, systemPrompt? }` | SSE stream of provider events |
| POST | `/v1/embed` | `{ texts: [...] }` | `{ embedder, dims, vectors: [...] }` |
| GET | `/v1/sources` | — | `{ sources: [{ id, name, transport }] }` |
| GET | `/v1/sources/probe` | — | `{ ok: [...], failed: [...] }` |
| GET | `/v1/sources/:id/tools` | — | `{ id, name, tools }` |
| POST | `/v1/sources/:id/tools/:tool` | `{ args }` | `{ ok, result }` |

### curl examples

```bash
curl http://127.0.0.1:3457/v1/health

curl http://127.0.0.1:3457/v1/embed \
  -H 'content-type: application/json' \
  -d '{"texts":["hello world"]}'

curl -N http://127.0.0.1:3457/v1/query \
  -H 'content-type: application/json' \
  -d '{"prompt":"What is 2+2?"}'
```

## Running everything

```bash
pnpm dev:full
```

Starts the backend AND space-agent concurrently. Open http://127.0.0.1:3456 to log in. The login hook (`customware/.../any_login/llm-wiki-init.js`) calls the backend `/v1/health`, then fires a fire-and-forget `/v1/embed` call to pre-warm the ONNX model — by the time you start chatting, the embedder is hot.

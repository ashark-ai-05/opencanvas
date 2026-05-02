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

# Plan 1.6 — Wire It Together Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an HTTP backend that exposes our LLM provider, embedder, and MCP source registry; wire space-agent's customware to call the backend so chat actually flows through our `LLMProvider`; pre-warm the embedder on app launch.

**Architecture:** A small Hono-based HTTP backend (`src/backend/server.ts`) runs on `localhost:3457` and exposes four endpoints: `/v1/health`, `/v1/query` (streaming via SSE), `/v1/embed`, and `/v1/sources/*`. Space-agent customware extensions (`customware/.../ext/js/.../*.js`) call this backend via plain `fetch`. Two processes (`pnpm backend` and `pnpm dev` for space-agent) are orchestrated by a new `pnpm dev:full` script using `concurrently`. The customware integration mirrors the upstream `open_router/` module pattern Spike 05 documented: hook into `prepareOnscreenAgentApiRequest/end` and `prepareAdminAgentApiRequest/end` to intercept chat requests, plus a login hook to pre-warm the embedder on first sign-in.

**Tech Stack:** Node.js 24+ · TypeScript · `hono` (tiny, web-standard, supports SSE out of the box) · `concurrently` (orchestrates two dev processes) · existing Vitest / tsx / Plan 1' provider layer / Plan 1 embedder layer / Plan 2 MCP layer / Plan 1.5 customware skeleton.

**References:**
- Design spec: `docs/superpowers/specs/2026-05-02-llm-wiki-design.md` §2 (architecture flow), §6 (agent loop — query enters space-agent, runs through our LLMProvider)
- Spec amendment 3: pre-warm the embedder on app launch is mandatory
- Spike 05: `_core/login_hooks/any_login` and `prepareOnscreenAgentApiRequest/end` are real seams; `open_router/` is the canonical extension example
- Plan 1.5: customware mounting + proof-of-wire banner (`_core/dashboard/content_end`) is working

**Out of scope (deferred):**
- Indexer pipelines populating chunks/embeddings (Plan 3 — code, document, ticket indexers)
- Cross-source link resolver (Plan 3)
- Capability verb mapping over MCP tools — search/fetch/list/subscribe (Plan 3)
- Authoring widgets and canvas templates from queries (Plans 5–7)
- Backend auth — `localhost`-only for v1.6 (defer hardening until we ship beyond local-dev)
- Multi-user / process isolation — same single-user, single-machine assumption as everything else

---

## File structure

### New files

```
src/
  backend/
    server.ts                    # Hono app: assembles routes, listens on :3457
    routes/
      health.ts                  # GET /v1/health
      query.ts                   # POST /v1/query — streams text deltas via SSE
      embed.ts                   # POST /v1/embed
      sources.ts                 # GET /v1/sources, GET /v1/sources/:id/tools, POST /v1/sources/:id/tools/:tool
    state.ts                     # singleton: active profile + LLMProvider + EmbeddingProvider + SourceRegistry
__tests__/
  backend.test.ts                # in-process tests against the Hono app (no live HTTP)
customware/
  L1/_all/mod/krunal/llm-wiki/
    ext/
      js/
        _core/onscreen_agent/prepareOnscreenAgentApiRequest/end/
          llm-wiki.js            # intercepts chat requests; routes through our backend
        _core/login_hooks/any_login/
          llm-wiki-init.js       # pre-warm the embedder; load profile health
      request.js                 # shared helper: fetch(LLM_WIKI_BACKEND/path) with errors normalized
scripts/
  dev-full.sh                    # uses `concurrently` to run backend + space-agent
  backend.sh                     # boots only the backend (used in CI smoke and by dev-full)
```

### Modified files

```
package.json                     # add deps: hono; devDeps: concurrently; scripts: backend, dev:full, backend:check
README.md                        # backend section + dev:full workflow + customware integration
```

### Files explicitly NOT modified

`src/core/**`, `src/providers/**`, `src/embedders/**`, `src/mcp/**`, `src/storage/**`, `src/config/**`, `src/cli.ts` — Plans 1', 1, and 2 stay stable. We expose them via the backend without touching their implementations.

The space-agent vendored repo (`vendor/space-agent/`) is also not touched — all extension lives in `customware/`.

---

## Task 0: Add Hono and concurrently

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add deps**

Edit `package.json`:

```json
"dependencies": {
  // ... existing ...
  "hono": "^4.0.0",
  "@hono/node-server": "^1.10.0"
}
```

```json
"devDependencies": {
  // ... existing ...
  "concurrently": "^9.0.0"
}
```

If those exact versions don't resolve cleanly, fall back to `*` — internal dev infra.

- [ ] **Step 2: Install**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm install
```

Expected: clean install, all pure JS.

- [ ] **Step 3: Verify typecheck still passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add package.json pnpm-lock.yaml
git commit -m "chore: add hono and concurrently for backend"
```

---

## Task 1: Backend state singleton

**Files:**
- Create: `src/backend/state.ts`

A single `BackendState` object holds the active profile, materialized LLM provider, embedder, and (lazily-loaded) source registry. Routes consume it. Initialized once at server start.

- [ ] **Step 1: Write the failing test**

Create `__tests__/backend.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { BackendState } from '../src/backend/state.js';

describe('BackendState', () => {
  it('lazily creates the LLM provider for the active profile', async () => {
    const state = await BackendState.create();
    const provider = state.getLLMProvider();
    expect(provider.kind).toBeDefined();
    expect(provider.id).toBeDefined();
  });

  it('lazily creates the embedder for the active profile', async () => {
    const state = await BackendState.create();
    const embedder = state.getEmbedder();
    expect(embedder.dims).toBeGreaterThan(0);
    expect(embedder.id).toBeDefined();
  });

  it('returns the profile name', async () => {
    const state = await BackendState.create();
    expect(typeof state.profileName).toBe('string');
    expect(state.profileName.length).toBeGreaterThan(0);
  });

  it('source registry starts empty until ensureSourcesConnected is awaited', async () => {
    const state = await BackendState.create();
    expect(state.getSourceRegistry().list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test backend
```

Expected: FAIL — `src/backend/state.js` not found.

- [ ] **Step 3: Implement `BackendState`**

Create `src/backend/state.ts`:

```typescript
import { loadConfig } from '../config/loader.js';
import { createProvider } from '../providers/index.js';
import { createEmbedder } from '../embedders/index.js';
import { SourceRegistry } from '../mcp/registry.js';
import type { Profile } from '../config/schema.js';
import type { LLMProvider } from '../core/provider.js';
import type { EmbeddingProvider } from '../core/embedding-provider.js';

/**
 * Backend state. Constructed once at server start. Holds the
 * resolved active profile and lazily-instantiated providers.
 *
 * Note: `getLLMProvider()` and `getEmbedder()` are synchronous because
 * provider/embedder construction is itself synchronous (no I/O at ctor time).
 * The MCP source registry is async — call `ensureSourcesConnected()`
 * before using it; subsequent calls are cached.
 */
export class BackendState {
  readonly profile: Profile;
  readonly profileName: string;

  private llmProvider: LLMProvider | null = null;
  private embedder: EmbeddingProvider | null = null;
  private sourceRegistry = new SourceRegistry();
  private sourcesConnectedPromise: Promise<void> | null = null;

  private constructor(profile: Profile) {
    this.profile = profile;
    this.profileName = profile.name;
  }

  static async create(): Promise<BackendState> {
    const { activeProfile } = await loadConfig({});
    return new BackendState(activeProfile);
  }

  getLLMProvider(): LLMProvider {
    if (!this.llmProvider) {
      this.llmProvider = createProvider(this.profile);
    }
    return this.llmProvider;
  }

  getEmbedder(): EmbeddingProvider {
    if (!this.embedder) {
      this.embedder = createEmbedder(this.profile);
    }
    return this.embedder;
  }

  getSourceRegistry(): SourceRegistry {
    return this.sourceRegistry;
  }

  /**
   * Connects every configured source. Idempotent — subsequent calls
   * await the same promise.
   */
  async ensureSourcesConnected(): Promise<void> {
    if (this.sourcesConnectedPromise) {
      return this.sourcesConnectedPromise;
    }
    this.sourcesConnectedPromise = (async () => {
      await this.sourceRegistry.connectAll(this.profile.sources);
    })();
    return this.sourcesConnectedPromise;
  }

  async shutdown(): Promise<void> {
    await this.sourceRegistry.closeAll();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test backend
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/backend/state.ts __tests__/backend.test.ts
git commit -m "feat(backend): BackendState singleton with lazy provider construction"
```

---

## Task 2: Health and Hono app skeleton

**Files:**
- Create: `src/backend/server.ts`
- Create: `src/backend/routes/health.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/backend.test.ts`:

```typescript
import { app } from '../src/backend/server.js';

describe('GET /v1/health', () => {
  it('returns ok with profile metadata', async () => {
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; profile: string };
    expect(json.ok).toBe(true);
    expect(typeof json.profile).toBe('string');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test backend
```

Expected: FAIL — `src/backend/server.js` not found.

- [ ] **Step 3: Implement health route**

Create `src/backend/routes/health.ts`:

```typescript
import { Hono } from 'hono';
import type { BackendState } from '../state.js';

export function healthRoute(state: BackendState): Hono {
  const r = new Hono();
  r.get('/v1/health', (c) =>
    c.json({
      ok: true,
      profile: state.profileName,
      llm: state.getLLMProvider().id,
      embedder: state.getEmbedder().id,
    })
  );
  return r;
}
```

- [ ] **Step 4: Implement the server skeleton**

Create `src/backend/server.ts`:

```typescript
import { Hono } from 'hono';
import { BackendState } from './state.js';
import { healthRoute } from './routes/health.js';

/**
 * The Hono app. Tests can hit `app.request(path)` directly without
 * spinning up an HTTP listener. The standalone listener is started
 * by `start()` in the same module.
 */
export const app = new Hono();

let state: BackendState | null = null;

async function getState(): Promise<BackendState> {
  if (!state) state = await BackendState.create();
  return state;
}

// Routes are mounted lazily on first request to avoid blocking module
// import on profile loading. This also keeps tests fast.
app.use('*', async (c, next) => {
  if (!state) {
    state = await BackendState.create();
    app.route('/', healthRoute(state));
  }
  await next();
});

export async function start(port: number): Promise<void> {
  const { serve } = await import('@hono/node-server');
  const s = await getState();
  // Force route mount before listen
  app.route('/', healthRoute(s));
  serve({ fetch: app.fetch, port });
  console.log(`[llm-wiki backend] listening on http://127.0.0.1:${port}`);
  console.log(`[llm-wiki backend] profile: ${s.profileName}`);
  console.log(`[llm-wiki backend] llm:     ${s.getLLMProvider().id}`);
  console.log(`[llm-wiki backend] embed:   ${s.getEmbedder().id}`);
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test backend
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/backend/server.ts src/backend/routes/health.ts __tests__/backend.test.ts
git commit -m "feat(backend): Hono app skeleton with /v1/health"
```

---

## Task 3: /v1/query — streaming via SSE

**Files:**
- Create: `src/backend/routes/query.ts`
- Modify: `src/backend/server.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/backend.test.ts`:

```typescript
describe('POST /v1/query', () => {
  it('returns 400 when prompt is missing', async () => {
    const res = await app.request('/v1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 200 with text/event-stream content-type when prompt is provided', async () => {
    // The actual provider may attempt a real call; for this unit test we
    // only verify the wire-up: status code and content-type. The provider
    // call is exercised in CLI / integration tests elsewhere.
    const res = await app.request('/v1/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'hello' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test backend
```

Expected: FAIL — route not registered yet.

- [ ] **Step 3: Implement query route**

Create `src/backend/routes/query.ts`:

```typescript
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { BackendState } from '../state.js';

export function queryRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/query', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      prompt?: string;
      systemPrompt?: string;
    };
    if (!body.prompt) {
      return c.json({ error: 'prompt is required' }, 400);
    }

    return streamSSE(c, async (stream) => {
      const provider = state.getLLMProvider();
      try {
        for await (const event of provider.query({
          prompt: body.prompt!,
          systemPrompt: body.systemPrompt,
        })) {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event),
          });
        }
      } catch (e) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            type: 'error',
            message: e instanceof Error ? e.message : String(e),
          }),
        });
      }
    });
  });

  return r;
}
```

- [ ] **Step 4: Wire query route into the server**

Edit `src/backend/server.ts`. Update the middleware that mounts routes lazily, and the `start()` function, to also mount `queryRoute`:

```typescript
import { healthRoute } from './routes/health.js';
import { queryRoute } from './routes/query.js';

// In the middleware:
//   app.route('/', healthRoute(state));
//   app.route('/', queryRoute(state));

// In start():
//   app.route('/', healthRoute(s));
//   app.route('/', queryRoute(s));
```

- [ ] **Step 5: Run the test**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test backend
```

Expected: PASS, including both `/v1/query` tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/backend/routes/query.ts src/backend/server.ts __tests__/backend.test.ts
git commit -m "feat(backend): POST /v1/query with SSE streaming"
```

---

## Task 4: /v1/embed

**Files:**
- Create: `src/backend/routes/embed.ts`
- Modify: `src/backend/server.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/backend.test.ts`:

```typescript
describe('POST /v1/embed', () => {
  it('returns 400 when texts is missing or empty', async () => {
    const r1 = await app.request('/v1/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(r1.status).toBe(400);

    const r2 = await app.request('/v1/embed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: [] }),
    });
    expect(r2.status).toBe(400);
  });

  // The actual embedding call hits the model; we don't run it here
  // (would slow tests and require model download). Coverage of the
  // happy path comes via the live `pnpm cli --embed` smoke from Plan 1
  // and the curl example in the README.
});
```

- [ ] **Step 2: Implement embed route**

Create `src/backend/routes/embed.ts`:

```typescript
import { Hono } from 'hono';
import type { BackendState } from '../state.js';

export function embedRoute(state: BackendState): Hono {
  const r = new Hono();

  r.post('/v1/embed', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      texts?: string[];
    };
    if (!Array.isArray(body.texts) || body.texts.length === 0) {
      return c.json({ error: 'texts must be a non-empty array' }, 400);
    }
    const embedder = state.getEmbedder();
    const vectors = await embedder.embed(body.texts);
    return c.json({
      embedder: embedder.id,
      dims: embedder.dims,
      vectors: vectors.map((v) => Array.from(v)),
    });
  });

  return r;
}
```

- [ ] **Step 3: Wire embed route into the server**

Edit `src/backend/server.ts` to also mount `embedRoute(state)` in both the lazy middleware and `start()`.

- [ ] **Step 4: Run tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test backend
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/backend/routes/embed.ts src/backend/server.ts __tests__/backend.test.ts
git commit -m "feat(backend): POST /v1/embed"
```

---

## Task 5: /v1/sources/* — list, tools, call

**Files:**
- Create: `src/backend/routes/sources.ts`
- Modify: `src/backend/server.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/backend.test.ts`:

```typescript
describe('GET /v1/sources', () => {
  it('returns the configured source list (possibly empty)', async () => {
    const res = await app.request('/v1/sources');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { sources: { id: string; name: string }[] };
    expect(Array.isArray(json.sources)).toBe(true);
  });
});
```

- [ ] **Step 2: Implement sources routes**

Create `src/backend/routes/sources.ts`:

```typescript
import { Hono } from 'hono';
import type { BackendState } from '../state.js';

export function sourcesRoute(state: BackendState): Hono {
  const r = new Hono();

  // List configured sources (without connecting). For runtime status,
  // hit /v1/sources/probe.
  r.get('/v1/sources', (c) => {
    return c.json({
      sources: state.profile.sources.map((s) => ({
        id: s.id,
        name: s.name,
        transport: s.transport,
      })),
    });
  });

  // Connect every source and return health + tool count.
  r.get('/v1/sources/probe', async (c) => {
    const registry = state.getSourceRegistry();
    const result = await registry.connectAll(state.profile.sources);
    return c.json({
      ok: result.ok.map((s) => ({
        id: s.id,
        name: s.name,
        health: s.health,
        toolCount: s.tools.length,
      })),
      failed: result.failed.map((f) => ({
        id: f.config.id,
        name: f.config.name,
        error: f.error,
      })),
    });
  });

  // List tools for one source (connecting on-demand).
  r.get('/v1/sources/:id/tools', async (c) => {
    const id = c.req.param('id');
    const config = state.profile.sources.find((s) => s.id === id);
    if (!config) return c.json({ error: `unknown source: ${id}` }, 404);

    const { createMcpClient } = await import('../../mcp/transport.js');
    const { MCPSource } = await import('../../mcp/source.js');
    const client = await createMcpClient(config);
    const source = new MCPSource(config.id, config.name, client);
    try {
      await source.introspect();
      return c.json({
        id: source.id,
        name: source.name,
        tools: source.tools,
      });
    } finally {
      await source.close();
    }
  });

  // Call a single tool. Body: { args: <json> }.
  r.post('/v1/sources/:id/tools/:tool', async (c) => {
    const id = c.req.param('id');
    const toolName = c.req.param('tool');
    const config = state.profile.sources.find((s) => s.id === id);
    if (!config) return c.json({ error: `unknown source: ${id}` }, 404);

    const body = (await c.req.json().catch(() => ({}))) as { args?: unknown };

    const { createMcpClient } = await import('../../mcp/transport.js');
    const { MCPSource } = await import('../../mcp/source.js');
    const client = await createMcpClient(config);
    const source = new MCPSource(config.id, config.name, client);
    try {
      const result = await source.callTool(toolName, body.args ?? {});
      return c.json({ ok: true, result });
    } catch (e) {
      return c.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        500
      );
    } finally {
      await source.close();
    }
  });

  return r;
}
```

- [ ] **Step 3: Wire sources route into the server**

Edit `src/backend/server.ts` to also mount `sourcesRoute(state)`.

- [ ] **Step 4: Run tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test backend
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/backend/routes/sources.ts src/backend/server.ts __tests__/backend.test.ts
git commit -m "feat(backend): /v1/sources, /v1/sources/probe, /v1/sources/:id/tools[/:tool]"
```

---

## Task 6: Backend boot script + entry

**Files:**
- Create: `scripts/backend.sh`
- Modify: `package.json`
- Modify: `src/backend/server.ts` (add an `import.meta.main`-style entry)

- [ ] **Step 1: Add a CLI entry to `server.ts`**

Append to `src/backend/server.ts`:

```typescript
// Run via `pnpm tsx src/backend/server.ts` or `pnpm backend`.
// We detect this by checking process.argv[1] against the resolved module URL.
import { fileURLToPath } from 'node:url';
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = Number(process.env.LLM_WIKI_BACKEND_PORT ?? 3457);
  start(port).catch((e) => {
    console.error('[llm-wiki backend] fatal:', e);
    process.exit(1);
  });
}
```

- [ ] **Step 2: Create `scripts/backend.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

PORT="${LLM_WIKI_BACKEND_PORT:-3457}"

if [ "${1:-}" = "--smoke" ]; then
  echo "==> Booting backend on :$PORT (smoke)"
  pnpm tsx src/backend/server.ts &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
  for i in $(seq 1 10); do
    if curl -sf "http://127.0.0.1:$PORT/v1/health" -o /dev/null; then
      echo "==> /v1/health responded — smoke OK"
      exit 0
    fi
    sleep 1
  done
  echo "==> Backend did not respond within 10s" >&2
  exit 1
fi

echo "==> Booting backend on http://127.0.0.1:$PORT"
exec pnpm tsx src/backend/server.ts
```

```bash
chmod +x scripts/backend.sh
```

- [ ] **Step 3: Add scripts to `package.json`**

Add to `scripts`:

```json
"backend": "bash scripts/backend.sh",
"backend:check": "bash scripts/backend.sh --smoke",
"dev:full": "concurrently --names 'backend,space-agent' --kill-others --kill-others-on-fail 'pnpm backend' 'pnpm dev'"
```

- [ ] **Step 4: Smoke-test the backend**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm backend:check
```

Expected: prints "==> /v1/health responded — smoke OK", exits 0 within 10 seconds. If it fails, debug:
- Port collision: try `LLM_WIKI_BACKEND_PORT=3458 pnpm backend:check`
- Hono module resolution: confirm typecheck passes
- `tsx` not installed: confirm dev deps from Plan 1' are intact

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add scripts/backend.sh src/backend/server.ts package.json
git commit -m "feat(backend): pnpm backend / backend:check / dev:full scripts"
```

---

## Task 7: Customware request helper

**Files:**
- Create: `customware/L1/_all/mod/krunal/llm-wiki/ext/request.js`

This is a plain JS module (space-agent loads it as ES module) that provides `query`, `embed`, and `health` helpers calling our backend. The actual hook files in Tasks 8 and 9 use these helpers — keeping the fetch shape DRY.

- [ ] **Step 1: Create the helper**

```javascript
// llm-wiki backend client. Loaded by customware extension hooks.
//
// The backend listens on http://127.0.0.1:3457 by default. Override with
// the LLM_WIKI_BACKEND_URL env var when launching space-agent.

const DEFAULT_URL = 'http://127.0.0.1:3457';

export function getBackendUrl() {
  return (
    (typeof process !== 'undefined' && process.env?.LLM_WIKI_BACKEND_URL) ||
    DEFAULT_URL
  );
}

export async function health() {
  const res = await fetch(`${getBackendUrl()}/v1/health`);
  if (!res.ok) throw new Error(`llm-wiki backend health failed: ${res.status}`);
  return res.json();
}

export async function embed(texts) {
  const res = await fetch(`${getBackendUrl()}/v1/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texts }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`llm-wiki embed failed: ${err.error}`);
  }
  return res.json();
}

/**
 * Query the LLM. Returns an async iterator of ProviderEvent objects parsed
 * from the SSE stream.
 */
export async function* query({ prompt, systemPrompt }) {
  const res = await fetch(`${getBackendUrl()}/v1/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, systemPrompt }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`llm-wiki query failed: ${err.error}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Parse complete SSE events (separated by \n\n)
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = block.split('\n').find((line) => line.startsWith('data:'));
      if (!dataLine) continue;
      try {
        yield JSON.parse(dataLine.slice(5).trim());
      } catch {
        // skip malformed
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add customware/L1/_all/mod/krunal/llm-wiki/ext/request.js
git commit -m "feat(customware): request.js helper for llm-wiki backend"
```

---

## Task 8: Customware login hook — pre-warm the embedder

**Files:**
- Create: `customware/L1/_all/mod/krunal/llm-wiki/ext/js/_core/login_hooks/any_login/llm-wiki-init.js`

Per spec amendment 3, the embedder must be pre-warmed at app launch so users never see the ~4.5s cold-start. We hook `_core/login_hooks/any_login` (the seam Spike 05 documented) and fire-and-forget a `health()` + `embed(['warmup'])` call.

- [ ] **Step 1: Create the directory**

```bash
mkdir -p /Users/krunal/Development/llm-wiki/customware/L1/_all/mod/krunal/llm-wiki/ext/js/_core/login_hooks/any_login
```

- [ ] **Step 2: Create the hook**

Create `customware/L1/_all/mod/krunal/llm-wiki/ext/js/_core/login_hooks/any_login/llm-wiki-init.js`:

```javascript
// Fires after any successful login. Pre-warms the embedder via the
// llm-wiki backend so the first user query doesn't pay the ONNX cold-
// start (~4.5s on M-series CPU). Best effort; failures are logged but
// do not block login.
//
// Per design spec amendment 3: pre-warm on app launch is mandatory.

import { health, embed } from '../../../../request.js';

export default async function init() {
  try {
    const h = await health();
    console.info('[llm-wiki] backend healthy:', h);
  } catch (e) {
    console.warn('[llm-wiki] backend health check failed:', e?.message ?? e);
    return;
  }

  // Fire-and-forget warmup. Do not await — returns immediately so login
  // is not delayed.
  embed(['warmup']).catch((e) => {
    console.warn('[llm-wiki] embedder warmup failed:', e?.message ?? e);
  });
}
```

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add customware/L1/_all/mod/krunal/llm-wiki/ext/js/_core/login_hooks/
git commit -m "feat(customware): login hook pre-warms embedder via backend"
```

---

## Task 9: Customware chat hook — route through our LLM provider

**Files:**
- Create: `customware/L1/_all/mod/krunal/llm-wiki/ext/js/_core/onscreen_agent/prepareOnscreenAgentApiRequest/end/llm-wiki.js`

This is the load-bearing extension. It fires inside space-agent's chat surface during request preparation. Our hook overrides the provider dispatch: if the user message can be answered via our `LLMProvider`, we yield text deltas back into space-agent's expected stream shape; if not, fall through to the default.

**Important**: the exact shape of `request` and `response` in this hook is space-agent-internal. Read the upstream `open_router/` module (in `vendor/space-agent/app/L0/_all/mod/_core/onscreen_agent/...` or wherever it actually lives — Spike 05 noted the canonical example was the `open_router/` module) for the shape. The code below is a **best-effort scaffold**; the executing subagent must verify the hook signature against the real upstream module and adapt as needed. Document any deviation in the commit message.

- [ ] **Step 1: Inspect the upstream `open_router/` module**

Before writing the hook, read upstream for the actual hook signature:

```bash
find /Users/krunal/Development/llm-wiki/vendor/space-agent -path '*open_router*' -name '*.js' | head -10
```

For each file found, read it. Identify:
- The exported function shape (sync? async? what arguments?)
- How it modifies the `request` parameter
- How it returns a response (mutates? returns?)
- What the `space.extend(import.meta, ...)` envelope looks like

Document the actual shape in a comment at the top of `llm-wiki.js`.

- [ ] **Step 2: Create the hook directory and file**

```bash
mkdir -p /Users/krunal/Development/llm-wiki/customware/L1/_all/mod/krunal/llm-wiki/ext/js/_core/onscreen_agent/prepareOnscreenAgentApiRequest/end
```

Create the hook (this is a scaffold — verify against upstream and adapt):

```javascript
// Routes the onscreen agent's chat request through our backend so that
// space-agent's chat actually flows through the LLMProvider configured
// in ~/.llm-wiki/config.json.
//
// Reference upstream: vendor/space-agent/<path>/open_router/...
// (Confirm exact path and adapt argument shape during implementation.)

import { query } from '../../../../../../request.js';

// Space-agent calls this with whatever arguments its hook engine provides.
// The most common pattern (per Spike 05's read of open_router) is a single
// `request` object that accumulates provider-specific metadata before being
// dispatched.
export default async function llmWikiHook(request) {
  // Mark that llm-wiki is the active provider; downstream code should
  // honor this and skip the default provider call.
  request.llmWiki = { providerId: null };

  try {
    const url = (typeof process !== 'undefined' && process.env?.LLM_WIKI_BACKEND_URL) || 'http://127.0.0.1:3457';
    const healthRes = await fetch(`${url}/v1/health`);
    if (!healthRes.ok) return request; // backend not up — fall through
    const health = await healthRes.json();
    request.llmWiki.providerId = health.llm;
    request.llmWiki.profile = health.profile;
  } catch (e) {
    console.warn('[llm-wiki] hook: backend not reachable, falling through:', e?.message ?? e);
    return request;
  }

  // Replace the default `dispatch` (or whatever the upstream contract names)
  // with one that calls our backend. The exact key name MUST be confirmed
  // against open_router/.
  request.dispatch = async function llmWikiDispatch({ messages }) {
    const userTurn = messages?.find?.((m) => m.role === 'user');
    if (!userTurn?.content) return null;
    const prompt = typeof userTurn.content === 'string'
      ? userTurn.content
      : userTurn.content.map((c) => c.text ?? '').join('');

    let text = '';
    for await (const event of query({ prompt })) {
      if (event.type === 'text-delta') text += event.text;
    }
    return { role: 'assistant', content: text };
  };

  return request;
}
```

- [ ] **Step 3: Commit**

The hook signature MAY need adjustment after inspecting upstream. If you adapt the signature, capture the actual shape in the commit message:

```bash
cd /Users/krunal/Development/llm-wiki
git add customware/L1/_all/mod/krunal/llm-wiki/ext/js/_core/onscreen_agent/
git commit -m "feat(customware): chat hook routes onscreen agent through backend"
```

If the chat hook turns out to be incompatible with the upstream contract (e.g. open_router uses `request.client.fetch` not `request.dispatch`, or hooks are called with different arguments), commit the scaffold AND open a follow-up issue / TODO comment in the hook file documenting what's needed. Do not block Plan 1.6 on getting the chat hook perfect — the scaffold + documentation is the deliverable.

---

## Task 10: README — backend + dev:full + customware

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Running the backend" section**

Append to `README.md`:

```markdown
## Running the backend

The backend exposes our LLM provider, embedder, and MCP source registry over HTTP so space-agent's customware can route through them.

### Ports and env

- Default port: `3457`. Override with `LLM_WIKI_BACKEND_PORT=3458 pnpm backend`.
- Default URL for customware: `http://127.0.0.1:3457`. Override with `LLM_WIKI_BACKEND_URL=...` when launching space-agent.

### Smoke check

\`\`\`bash
pnpm backend:check
\`\`\`

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

\`\`\`bash
curl http://127.0.0.1:3457/v1/health

curl http://127.0.0.1:3457/v1/embed \\
  -H 'content-type: application/json' \\
  -d '{"texts":["hello world"]}'

curl -N http://127.0.0.1:3457/v1/query \\
  -H 'content-type: application/json' \\
  -d '{"prompt":"What is 2+2?"}'
\`\`\`

## Running everything

\`\`\`bash
pnpm dev:full
\`\`\`

Starts the backend AND space-agent concurrently. Open http://127.0.0.1:3456 to log in. The login hook (`customware/.../any_login/llm-wiki-init.js`) calls the backend `/v1/health`, then fires a fire-and-forget `/v1/embed` call to pre-warm the ONNX model — by the time you start chatting, the embedder is hot.
```

(Replace escaped backticks with real triple-backticks.)

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add README.md
git commit -m "docs: backend, dev:full workflow, customware integration"
```

---

## Spec coverage check

| Spec section / amendment | Implemented in |
| --- | --- |
| Spec §2 — backend exposing LLM + embed + MCP | Tasks 1–5 |
| Spec §6 — query enters → routed through provider | Task 9 (chat hook) + Task 3 (`/v1/query`) |
| Amendment 3 — pre-warm embedder on launch | Task 8 (login hook) |
| Spike 05 — `_core/login_hooks/any_login` real seam | Task 8 |
| Spike 05 — `prepareOnscreenAgentApiRequest/end` pattern from open_router | Task 9 |

**Out of scope (deferred — already enumerated in plan header):**
- Indexer pipelines (Plan 3)
- Cross-source link resolver (Plan 3)
- Capability verb mapping (Plan 3)
- Authoring widgets / canvas templates (Plans 5–7)
- Backend auth (post-v1)

---

## Verification before declaring complete

- [ ] All tests pass: `pnpm test` exits 0
- [ ] Typecheck passes: `pnpm typecheck` exits 0
- [ ] `pnpm backend:check` exits 0
- [ ] `pnpm dev:full` boots both processes; backend logs appear; space-agent boots on :3456
- [ ] Manual curl against `/v1/health`, `/v1/embed`, `/v1/sources` returns sensible responses
- [ ] After login at :3456, browser console shows `[llm-wiki] backend healthy:` log from the login hook
- [ ] `git log --oneline` shows ~10 new commits (one per task 0–10)
- [ ] No `vendor/space-agent/`, `node_modules`, or build artifacts committed

The chat hook (Task 9) is best-effort — if it doesn't fully integrate with space-agent's chat dispatch on first attempt, the scaffold + TODO comment is acceptable and the user will iterate. The other 9 tasks must be solid.

---

*End of Plan 1.6.*

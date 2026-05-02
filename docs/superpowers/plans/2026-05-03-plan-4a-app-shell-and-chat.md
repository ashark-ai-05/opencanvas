# Plan 4a — Native UI Shell + Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a native React + Vite app at `app/` that talks to our existing Hono backend on `:3457` for chat and health. Replaces space-agent as the UI shell. No canvas yet — that's Plan 4b. The app must visibly chat through our `LLMProvider` end-to-end with no space-agent in the loop.

**Architecture:** Vite serves a SPA at `:3458` with an HMR dev server. The app uses `@ai-sdk/react`'s `useChat` against `/v1/query/openai` (already OpenAI-compat — no adapter needed). On load, the app probes `/v1/health` and shows backend status in a `HealthBadge`. State lives in a Zustand store. Two pnpm scripts (`pnpm app`, `pnpm app:build`) plus an updated `pnpm dev:full` that runs backend + app concurrently. **No new server-side code in this plan** — backend is unchanged.

**Tech Stack:** Vite 6 · React 19 · TypeScript 5 · Tailwind 4 · `ai` v6 + `@ai-sdk/react` · Zustand 5 · lucide-react · Vitest + @testing-library/react + jsdom.

**References:**
- Design spec: `docs/superpowers/specs/2026-05-02-llm-wiki-design.md` §1 (vision: local desktop app), §6 (agent loop — UI calls `/v1/query/openai`)
- Plan 1.6/1.7: `/v1/query/openai` already exists; OpenAI chat-completions SSE format already verified end-to-end
- Plan 1' (vertical slice): `LLMProvider` abstraction is what the backend dispatches to

**Plan 4 decomposition (this is 4a):**
- **4a (this plan):** App scaffold + chat panel + health probe. No canvas.
- **4b:** Infinite canvas (tldraw) + `Widget` abstraction + chat as a tldraw shape + canvas persistence as markdown bundles.
- **4c:** Built-in widget catalog — `MarkdownWidget`, `CodeBlockWidget`, `TicketCardWidget`, `SearchResultsWidget`, `SourceProbeWidget`.
- **4d:** Result dispatcher — agent's `ResultEnvelope` outputs become widgets on the canvas.
- **4e:** 4 canvas templates from spec §3 (AskAnything, TellMeAboutX, WhatsNewSinceY, TraceXEverywhere).

**Out of scope for 4a:**
- Canvas (4b)
- Widgets (4c)
- Result envelope rendering (4d)
- Auth — localhost-only single-user; no login screen
- Persistence of conversations (the chat history is ephemeral until 4b adds canvas-bundle save/load)
- Source/MCP probe UI (defer to 4c — easy widget once we have the catalog)
- Search UI (defer to 4c)

---

## File structure

### New files

```
app/
  index.html                    # Vite entry
  vite.config.ts                # Vite config — :3458 with /v1 proxy to :3457
  tsconfig.json                 # extends root tsconfig with React JSX
  tsconfig.node.json            # Vite-specific config for vite.config.ts itself
  src/
    main.tsx                    # React 19 root
    App.tsx                     # Top-level component
    components/
      Chat.tsx                  # Chat panel using @ai-sdk/react useChat
      HealthBadge.tsx           # Backend health indicator (dot + label)
    state/
      app-store.ts              # Zustand store: backend health + active profile
    api/
      health.ts                 # GET /v1/health typed client
    styles/
      globals.css               # Tailwind 4 directives + base styles
__tests__/
  app/
    HealthBadge.test.tsx        # renders the right state for ok / fail / loading
    Chat.smoke.test.tsx         # smoke: renders without crashing, has input
```

### Modified files

```
package.json                    # add deps + app, app:build, app:test, dev:full scripts
vitest.config.ts                # add jsdom env for app/__tests__
tsconfig.json                   # ensure app/ is excluded from the root build (root is Node only)
README.md                       # add "Running the app" section
.gitignore                      # ignore app/dist
```

### Files NOT touched

`src/**`, `__tests__/*.test.ts` (existing Node-side tests), `customware/`, `vendor/`, `examples/` — no backend changes; no space-agent changes.

---

## Task 0: Add deps + bootstrap directory

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add deps to root `package.json`**

Edit `package.json`. Add to `dependencies`:

```json
"react": "^19.0.0",
"react-dom": "^19.0.0",
"ai": "^6.0.0",
"@ai-sdk/react": "^2.0.0",
"zustand": "^5.0.0",
"lucide-react": "^0.460.0"
```

Add to `devDependencies`:

```json
"vite": "^6.0.0",
"@vitejs/plugin-react": "^4.3.0",
"@types/react": "^19.0.0",
"@types/react-dom": "^19.0.0",
"tailwindcss": "^4.0.0",
"@tailwindcss/vite": "^4.0.0",
"@testing-library/react": "^16.0.0",
"@testing-library/jest-dom": "^6.6.0",
"@testing-library/user-event": "^14.5.0",
"jsdom": "^25.0.0"
```

Use `*` for any version that doesn't resolve cleanly — internal dev infra.

- [ ] **Step 2: Add scripts**

In `package.json` `scripts`, add:

```json
"app": "vite",
"app:build": "vite build",
"app:preview": "vite preview"
```

Update the existing `dev:full` script to include the app:

```json
"dev:full": "concurrently --names 'backend,space-agent,app' --kill-others --kill-others-on-fail 'pnpm backend' 'pnpm dev' 'pnpm app'"
```

(Yes — for now we keep space-agent in `dev:full` so existing flows aren't broken. Plan 4d will retire it.)

Add a helper that runs ONLY backend + app (no space-agent):

```json
"dev:app": "concurrently --names 'backend,app' --kill-others --kill-others-on-fail 'pnpm backend' 'pnpm app'"
```

- [ ] **Step 3: Update `.gitignore`**

Append:

```
# Vite build output
app/dist/
.vite/

# Test environment artifacts
__tests__/app/.cache/
```

- [ ] **Step 4: Install**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm install
```

Expected: clean install, no native build attempts. If a peer-dep warning appears for React 19 + AI SDK, proceed — it's a known transition window.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add package.json pnpm-lock.yaml .gitignore
git commit -m "chore: add Vite + React 19 + AI SDK deps for app shell"
```

---

## Task 1: Vite + TypeScript config

**Files:**
- Create: `app/index.html`
- Create: `app/vite.config.ts`
- Create: `app/tsconfig.json`
- Create: `app/tsconfig.node.json`
- Modify: `tsconfig.json` (root)

- [ ] **Step 1: Create `app/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" href="data:," />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>llm-wiki</title>
  </head>
  <body class="h-screen bg-zinc-950 text-zinc-100">
    <div id="root" class="h-full"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `app/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  server: {
    port: 3458,
    strictPort: true,
    // Proxy /v1/* requests to the backend on :3457 so the SPA can
    // hit a same-origin /v1/* path without CORS issues in dev.
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:3457',
        changeOrigin: false,
        // Streaming endpoints (like /v1/query/openai) need pass-through.
        // Vite's http-proxy supports this by default; no extra config needed.
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
```

- [ ] **Step 3: Create `app/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "useDefineForClassFields": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "../__tests__/app"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create `app/tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Update root `tsconfig.json`**

Read the current root `tsconfig.json`. Add `"app"` and `"__tests__/app"` to its `exclude` array (it's a Node-only config; the app uses its own).

- [ ] **Step 6: Verify build is sane**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0. The root typecheck still passes since app/ is excluded.

- [ ] **Step 7: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/index.html app/vite.config.ts app/tsconfig.json app/tsconfig.node.json tsconfig.json
git commit -m "feat(app): Vite + TS config — port 3458 with /v1 proxy to backend"
```

---

## Task 2: Tailwind 4 + base styles

**Files:**
- Create: `app/src/styles/globals.css`

- [ ] **Step 1: Create `app/src/styles/globals.css`**

Tailwind 4 uses `@import "tailwindcss"` — no `@tailwind base/components/utilities` directives anymore.

```css
@import "tailwindcss";

@theme {
  --color-bg: #09090b;
  --color-fg: #fafafa;
  --color-muted: #71717a;
  --color-accent: #f59e0b;
  --color-ok: #22c55e;
  --color-fail: #ef4444;
}

@layer base {
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
    color: var(--color-fg);
    background: var(--color-bg);
  }

  code, pre {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/styles/globals.css
git commit -m "feat(app): Tailwind 4 globals + theme tokens"
```

---

## Task 3: API client + Zustand store

**Files:**
- Create: `app/src/api/health.ts`
- Create: `app/src/state/app-store.ts`
- Create: `__tests__/app/health.test.tsx`

The health client uses `fetch('/v1/health')` (proxied to `:3457` in dev). The Zustand store holds health state.

- [ ] **Step 1: Implement health client**

Create `app/src/api/health.ts`:

```typescript
export type HealthResponse = {
  ok: boolean;
  profile: string;
  llm: string;
  embedder: string;
};

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/v1/health');
  if (!res.ok) {
    throw new Error(`Backend health check failed: ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 2: Implement Zustand store**

Create `app/src/state/app-store.ts`:

```typescript
import { create } from 'zustand';
import { fetchHealth, type HealthResponse } from '../api/health';

export type HealthState =
  | { status: 'loading' }
  | { status: 'ok'; data: HealthResponse }
  | { status: 'fail'; error: string };

type AppStore = {
  health: HealthState;
  refreshHealth: () => Promise<void>;
};

export const useAppStore = create<AppStore>((set) => ({
  health: { status: 'loading' },
  refreshHealth: async () => {
    set({ health: { status: 'loading' } });
    try {
      const data = await fetchHealth();
      set({ health: { status: 'ok', data } });
    } catch (e) {
      set({
        health: { status: 'fail', error: e instanceof Error ? e.message : String(e) },
      });
    }
  },
}));
```

- [ ] **Step 3: Write a smoke test for the health client**

Create `__tests__/app/health.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { fetchHealth } from '../../app/src/api/health';

describe('fetchHealth', () => {
  it('returns parsed JSON when backend responds 200', async () => {
    const stub = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ok: true, profile: 'test', llm: 'x', embedder: 'y' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const result = await fetchHealth();
    expect(result.ok).toBe(true);
    expect(result.profile).toBe('test');
    stub.mockRestore();
  });

  it('throws when backend returns non-200', async () => {
    const stub = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('error', { status: 500 })
    );
    await expect(fetchHealth()).rejects.toThrow(/500/);
    stub.mockRestore();
  });
});
```

- [ ] **Step 4: Run the test**

We need to run via Vite's vitest config. From `app/`:

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/health.test.tsx
```

Expected: PASS. If the test runner can't find the module via the relative import, adjust the path or add an alias in `vite.config.ts`.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/api/health.ts app/src/state/app-store.ts __tests__/app/health.test.tsx
git commit -m "feat(app): health API client + Zustand app store"
```

---

## Task 4: HealthBadge component

**Files:**
- Create: `app/src/components/HealthBadge.tsx`
- Create: `__tests__/app/HealthBadge.test.tsx`

Renders a colored dot + label based on health state. Polls every 30s.

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/HealthBadge.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { HealthBadge } from '../../app/src/components/HealthBadge';

describe('HealthBadge', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({ ok: true, profile: 'test', llm: 'claude-agent-sdk', embedder: 'onnx-bundled' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading state initially', () => {
    render(<HealthBadge />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders ok state with profile after fetch resolves', async () => {
    render(<HealthBadge />);
    await waitFor(() => {
      expect(screen.getByText(/test/)).toBeInTheDocument();
    });
  });

  it('renders fail state when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('connection refused'));
    render(<HealthBadge />);
    await waitFor(() => {
      expect(screen.getByText(/connection refused|backend down|fail/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Implement the component**

Create `app/src/components/HealthBadge.tsx`:

```typescript
import { useEffect } from 'react';
import { useAppStore } from '../state/app-store';

export function HealthBadge() {
  const { health, refreshHealth } = useAppStore();

  useEffect(() => {
    refreshHealth();
    const id = setInterval(refreshHealth, 30_000);
    return () => clearInterval(id);
  }, [refreshHealth]);

  if (health.status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <span className="size-2 rounded-full bg-zinc-500 animate-pulse" />
        <span>loading…</span>
      </div>
    );
  }

  if (health.status === 'fail') {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400" title={health.error}>
        <span className="size-2 rounded-full bg-red-500" />
        <span>backend down</span>
        <span className="text-xs text-zinc-500 truncate max-w-xs">{health.error}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-zinc-300">
      <span className="size-2 rounded-full bg-green-500" />
      <span className="font-medium">{health.data.profile}</span>
      <span className="text-zinc-500">·</span>
      <span className="text-zinc-500">{health.data.llm}</span>
    </div>
  );
}
```

- [ ] **Step 3: Run the test**

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/HealthBadge.test.tsx
```

Expected: PASS, all 3 tests.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/components/HealthBadge.tsx __tests__/app/HealthBadge.test.tsx
git commit -m "feat(app): HealthBadge component with 30s polling"
```

---

## Task 5: Chat component using @ai-sdk/react

**Files:**
- Create: `app/src/components/Chat.tsx`
- Create: `__tests__/app/Chat.smoke.test.tsx`

`@ai-sdk/react`'s `useChat` accepts an `api` prop pointing at our endpoint. Since `/v1/query/openai` returns OpenAI chat-completions SSE, the hook handles streaming + message state without further work.

- [ ] **Step 1: Implement the component**

Create `app/src/components/Chat.tsx`:

```typescript
import { useChat } from '@ai-sdk/react';
import { Send } from 'lucide-react';
import { useState } from 'react';

export function Chat() {
  const { messages, sendMessage, status } = useChat({
    api: '/v1/query/openai',
  });
  const [input, setInput] = useState('');
  const isStreaming = status === 'streaming';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput('');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-zinc-500 mt-12">
            <p className="text-lg">llm-wiki</p>
            <p className="text-sm">Type a message to start.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-wider text-zinc-500">
              {m.role}
            </div>
            <div className="whitespace-pre-wrap text-zinc-100">
              {m.parts
                ?.filter((p) => p.type === 'text')
                .map((p, i) => <span key={i}>{p.text}</span>) ?? m.content}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-zinc-800 p-4 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything…"
          disabled={isStreaming}
          className="flex-1 px-4 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          aria-label="Send"
          className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-100 disabled:opacity-50 disabled:hover:bg-zinc-800 transition-colors"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}
```

The exact `useChat` return-shape and `sendMessage` API depends on the installed AI SDK version. If the API differs, adapt: AI SDK 6 introduced the `parts`-based message structure; AI SDK 5 used a `content` string and `handleSubmit` handler. Adjust to match what `pnpm install` brought in.

- [ ] **Step 2: Write the smoke test**

Create `__tests__/app/Chat.smoke.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Chat } from '../../app/src/components/Chat';

describe('Chat (smoke)', () => {
  it('renders input and send button', () => {
    render(<Chat />);
    expect(screen.getByPlaceholderText(/ask anything/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/send/i)).toBeInTheDocument();
  });

  it('shows the welcome message when there are no messages', () => {
    render(<Chat />);
    expect(screen.getByText(/llm-wiki/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/
```

Expected: all app tests pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/components/Chat.tsx __tests__/app/Chat.smoke.test.tsx
git commit -m "feat(app): Chat component using @ai-sdk/react useChat"
```

---

## Task 6: App composition + entry point

**Files:**
- Create: `app/src/App.tsx`
- Create: `app/src/main.tsx`
- Create: `app/src/test-setup.ts`

- [ ] **Step 1: Create test setup**

Create `app/src/test-setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 2: Implement App**

Create `app/src/App.tsx`:

```typescript
import { Chat } from './components/Chat';
import { HealthBadge } from './components/HealthBadge';

export function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">
          llm-wiki
        </h1>
        <HealthBadge />
      </header>
      <main className="flex-1 overflow-hidden">
        <Chat />
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Implement main**

Create `app/src/main.tsx`:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element not found in index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 4: Smoke test the dev server**

Make sure the backend is running first:

```bash
cd /Users/krunal/Development/llm-wiki
# If not already running:
pnpm backend &
sleep 2
# Now boot the app
pnpm app &
APP_PID=$!
sleep 3
curl -sI http://127.0.0.1:3458 | head -3
# Verify /v1/health is reachable through the proxy
curl -s http://127.0.0.1:3458/v1/health | head -3
kill $APP_PID 2>/dev/null
```

Expected:
- Vite serves index.html on `:3458` (200)
- `/v1/health` proxied through to `:3457` returns the JSON

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/App.tsx app/src/main.tsx app/src/test-setup.ts
git commit -m "feat(app): App component + React 19 entry point"
```

---

## Task 7: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add an "App" section**

Append a new section to `README.md`:

```markdown
## Running the app

The native React + Vite UI lives at `app/`. Talks to the Hono backend on `:3457` via a Vite proxy on `:3458`.

### Dev mode

\`\`\`bash
# Start backend + app together (recommended)
pnpm dev:app
# → backend on :3457, app on :3458

# Open http://localhost:3458
\`\`\`

The chat input streams from `/v1/query/openai` (proxied to the backend) using `@ai-sdk/react`'s `useChat` — same OpenAI chat-completions SSE format we already serve.

### Build for production

\`\`\`bash
pnpm app:build
# → app/dist/

# Preview the built app:
pnpm app:preview
\`\`\`

In production you can serve `app/dist/` from the backend on `:3457` (single port). That wiring lands in Plan 4b alongside canvas persistence.

### Tests

\`\`\`bash
# Run all tests (Node + app)
pnpm test

# App tests only
pnpm exec vitest run __tests__/app/
\`\`\`

The app's component tests use `@testing-library/react` + `jsdom`. Existing Node-side tests are unchanged.

### Stack

- Vite 6, React 19, TypeScript 5, Tailwind 4
- Vercel AI SDK (`ai` + `@ai-sdk/react`) for chat streaming
- Zustand 5 for app-level state
- lucide-react for icons
- Vitest + @testing-library/react + jsdom for tests

### What's next (Plan 4b+)

Plan 4a (this) ships the chat shell. Future plans layer on:

- **4b**: tldraw infinite canvas + Widget abstraction + canvas persistence
- **4c**: Widget catalog (Markdown, CodeBlock, TicketCard, SearchResults, SourceProbe)
- **4d**: Result dispatcher — agent output materialises as widgets on the canvas
- **4e**: Canvas templates (AskAnything, TellMeAboutX, WhatsNewSinceY, TraceXEverywhere)
```

(Replace escaped backticks with real triple-backticks.)

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add README.md
git commit -m "docs: native UI shell + dev:app workflow"
```

---

## Spec coverage check

| Spec / vision | Implemented in (Plan 4a) | Deferred to |
| --- | --- | --- |
| Spec §1 — local desktop app shell | Tasks 1–6 (the `app/` scaffold + chat) | — |
| Spec §6 — query enters → routed through provider | Task 5 (`useChat` against `/v1/query/openai`) | — |
| Spec §3 — `Widget` abstraction | — | Plan 4b |
| Spec §1 — infinite canvas | — | Plan 4b |
| Spec §3 — built-in widget catalog | — | Plan 4c |
| Spec §6 — `ResultEnvelope` materialised on canvas | — | Plan 4d |
| Spec §3 — 4 canvas templates | — | Plan 4e |

All Plan 4a deliverables traced.

---

## Verification before declaring complete

- [ ] All tests pass: `pnpm test` exits 0 (Node tests + app tests)
- [ ] Typecheck passes: `pnpm typecheck` exits 0 (root tsconfig stays Node-only)
- [ ] App typecheck passes: `cd app && pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm app:build` exits 0 and writes to `app/dist/`
- [ ] `pnpm dev:app` boots both processes; `curl http://127.0.0.1:3458/v1/health` proxies through
- [ ] Manual smoke: open http://localhost:3458 in a browser; chat input visible; HealthBadge shows green dot + profile name
- [ ] Manual smoke: send a message; response streams via signed-in Claude; conversation appears
- [ ] `git log --oneline` shows ~8 new commits (one per task 0–7)

---

*End of Plan 4a.*

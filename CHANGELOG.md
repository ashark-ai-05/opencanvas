# Changelog

All notable changes to OpenCanvas are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Auto-tidy: after the first few widgets on a fresh canvas, cards arrange into a readable grid (also powers `/tidy` and welcome settle).
- `/v1/health` reports `searchReady`; the chat skips KB search until the embedder is ready or when the index is empty.
- First-run model auto-pick: an env API key or a running Ollama becomes the active profile (keys never written to disk).
- Background warm-up of the local search embedder so the first question doesn't stall.
- `remind me …` / `reminder: …` place on Enter without a model.
- Tables and task lists size to their content; wide cards stay left of the chat.
- Self-hosted Inter arrows subset so `→` renders in titles.
- Prepared (unpublished) `npx opencanvas` launcher and `Dockerfile.local` for a one-command install.
- `pnpm start`: one process on one port (127.0.0.1:3457) with no `.env`. It builds the UI on first run and opens the browser.
- A "No model connected yet" inline card with one-click instant-widget chips, replacing the raw `authentication_failed` toast.
- The header badge turns amber and reads "not connected" after the model rejects a turn.
- `docs/first-run.gif` and `scripts/record-first-run.mjs`, an unedited no-key first run.
- gzip and immutable caching for `/assets` when the backend serves the UI (2.5 MB → 0.77 MB on the wire).

### Fixed
- First chat turn no longer shows "Searching your knowledge base…" when nothing is indexed.
- Welcome sticky no longer lands under the floating chat after settle.
- App TypeScript: 6 errors fixed and `pnpm typecheck:app` added to CI (including a ShareButton that always fell back to "Shared OpenCanvas").
- Auth token write is atomic so concurrent first boots can't clobber each other.
- The first widget placed on a fresh canvas started collapsed, because welcome samples counted toward auto-collapse.
- Auto-collapse kicked in at the 4th widget (threshold raised 3 → 8).
- Pressing Enter before the fast-lane debounce fired sent instant widgets to the model.
- `todo: …` / `checklist: …` lead keywords were overridden by task verbs and words like "demo".
- New widgets were placed underneath the floating chat.
- 16 CSP console errors on every load (tldraw fonts).
- A broken `#install` README anchor in the demo capacity notice.

## [0.1.0] — 2026-09-27

### Added
- **Fast lane: instant local widgets** — a keyword classifier plus
  deterministic parsers (chrono-node for dates) recognise utility prompts
  (timer, stopwatch, clock, checklist, reminder, event, note, calc,
  convert) as you type. Enter places the widget through the dispatcher
  with no model call; ⌘/Ctrl+Enter asks the model instead. Calm-UI
  hysteresis ported from anishfn/shapeshift (MIT). Off by default in
  demo mode for the first deploy (`/v1/health` now reports `demo`).
  Setting: "Instant widgets" in Settings. Design:
  `docs/plans/fast-lane-intent.md`.
- **Unified agent path via Vercel AI SDK** — same widget-placing agent
  for every provider (Gemini, Anthropic, OpenAI, Groq, Ollama,
  OpenRouter). Previously only the Claude Agent SDK adapter had
  tool-calling; the others were text-only wrappers. Gated behind
  `OPENCANVAS_AGENT=v2` for one release while v1 soaks; will become
  the default. See [`docs/plans/unified-agent.md`](./docs/plans/unified-agent.md).
- **MCP source integration on the unified path** — configured MCP
  servers (filesystem, github, etc.) work with any model, not just
  Claude. Uses `@modelcontextprotocol/sdk` under the hood.
- **Extended thinking config wired per provider** —
  `model-resolver` auto-enables `providerOptions.anthropic.thinking`
  for Claude Sonnet/Opus 4+ and `providerOptions.google.thinkingConfig`
  (with `includeThoughts: true`) for Gemini 2.5/3.x and the `*-latest`
  aliases. The `ShowThinking` chat panel renders the resulting
  reasoning chunks. Known limitation: @ai-sdk/google v3 returns
  `thoughtSignature` but not the thought text in streaming mode, so
  Gemini thinking is invisible to users for now — Anthropic works.
  Workaround tracked for a follow-up.
- **Clickable demo prompts on the empty canvas** — the "empty canvas"
  hint now suggests three concrete prompts that fire the chat directly.
- **`/v1/health` reports model id** — header chip now shows
  `gemini · gemini-flash-lite-latest` instead of the misleading profile
  name.
- **Drag empty canvas to pan** — Figma-style. Dragging a widget still
  moves the widget; dragging empty space pans the camera. Shift+drag
  preserves marquee box-select.
- **Token-based backend auth** on state-mutating routes. Token is
  generated on first run and stored in `~/.opencanvas/auth-token`
  (mode 0600). Vite proxy and Electron preload inject it transparently;
  curl users grab it from the file.
- **App-level `ErrorBoundary`** — a single crashing render no longer
  white-screens the app. Shows the error, a "Reload" button, and a
  "Copy details" button for bug reports.
- **`LICENSE`** (MIT), **`SECURITY.md`** (threat model + responsible
  disclosure), **`CONTRIBUTING.md`**, and this `CHANGELOG.md`.
- **Frontend logger** (`app/src/lib/logger.ts`) — `debug`/`info`
  no-op in production builds.
- **Chat minimize button** toggles icon between `Minus` (open) and
  `ChevronUp` (minimized), with matching tooltip.

### Changed
- **CORS locked to localhost** — was `origin: (o) => o` which echoed
  any origin. Now an explicit allowlist of the Vite dev port and
  Electron `file://` origin. Closes the cross-tab CSRF window.
- **Vite dev server bound to `127.0.0.1`** — was `0.0.0.0`, which
  exposed the dev proxy on the LAN.
- **`clear` canvas directive** now also wipes hand-drawn strokes and
  other native shapes (previously skipped them). Pinned widgets still
  survive.
- **`package.json`** now declares description, license, repository,
  bugs URL, homepage, keywords, and a proper version (`0.1.0`).
- **`EmptyCanvasHint`** hides on any first shape (widget OR hand
  drawing) — was sticking around while users drew.
- **Floating chat clamp-to-viewport** — measures the actual rect after
  mode/fullMode changes and on resize, so restore-from-minimized no
  longer leaves the title bar off-screen.

### Security
- Patched 3 moderate CVEs via pnpm overrides:
  - `protobufjs` ≥7.5.8 — DoS via unbounded JSON descriptor recursion
    (transitive: `@huggingface/transformers` → `onnxruntime-web`)
  - `qs` ≥6.15.2 — DoS in `qs.stringify` on null/undefined comma-format
    entries (transitive: `@modelcontextprotocol/sdk` → `express`)
  - `ws` ≥8.20.1 — DoS via excessive `Sec-WebSocket-Extensions` header
    (transitive: `openai`)
- `pnpm audit --prod` is now clean.

## [0.0.0] — earlier development

The pre-launch series, captured in `git log` but not formally versioned.
Notable beats from the last few weeks (newest first):

- `feat(ui)` Conversation tabs strip in the canvas shell.
- `feat(canvas)` Send-widget-to-conversation paper-airplane action.
- `feat(backend)` `/v1/plugin-fetch` proxy so sandboxed iframes can
  fetch any URL.
- `feat(widgets)` Generative `html` widget + `register_widget_kind`
  agent tool — plugins can declare new widget kinds at runtime.
- `feat(widget)` Built-in calendar plugin (year/month grid with event
  dots).
- `feat(notebook)` Notes/Tasks/Calendar drawer + agent tools
  (`add_task`, `complete_task`, `read_notes`, `append_to_notes`).
- `feat(plugins)` `python-repl` (Pyodide) + `js-repl` example plugins.
- `feat(recall)` Cross-canvas global recall panel.

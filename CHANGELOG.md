# Changelog

All notable changes to OpenCanvas are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Unified agent path via Vercel AI SDK** — same widget-placing agent
  for every provider (Gemini, Anthropic, OpenAI, Groq, Ollama,
  OpenRouter). Previously only the Claude Agent SDK adapter had
  tool-calling; the others were text-only wrappers. Gated behind
  `OPENCANVAS_AGENT=v2` for one release while v1 soaks; will become
  the default. See [`docs/plans/unified-agent.md`](./docs/plans/unified-agent.md).
- **MCP source integration on the unified path** — configured MCP
  servers (filesystem, github, etc.) work with any model, not just
  Claude. Uses `@modelcontextprotocol/sdk` under the hood.
- **Extended thinking surfaces in the chat** — Gemini 2.5/3.x and
  Claude Sonnet/Opus 4+ emit `reasoning` parts that the `ShowThinking`
  panel renders. Auto-enabled per provider via `model-resolver`.
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

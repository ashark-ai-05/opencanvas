# Changelog

All notable changes to OpenCanvas are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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

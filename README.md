<div align="center">

<img src="build/icons/icon-256.png" alt="OpenCanvas" width="104" height="104" />

# OpenCanvas

### Stop reading AI replies. Watch them assemble on an infinite canvas.

Ask a question and get a chart, a table and a kanban side by side, each one a real widget you can drag, pin and keep. Any model, including local, running on your machine under MIT.

[![ci](https://github.com/ashark-ai-05/opencanvas/actions/workflows/ci.yml/badge.svg)](https://github.com/ashark-ai-05/opencanvas/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-822%20passing-2dd4bf)](./docs/guide.md#develop)
[![license](https://img.shields.io/badge/license-MIT-fbbf24)](./LICENSE)
[![stars](https://img.shields.io/github/stars/ashark-ai-05/opencanvas?style=flat&color=a78bfa)](https://github.com/ashark-ai-05/opencanvas/stargazers)

![demo](docs/demo.gif)

<p>
  <img src="docs/screenshots/mobile-390-after.png" alt="OpenCanvas on a 390px phone: chat docked as a bottom sheet with no-key chips" width="210" />
  &nbsp;
  <img src="docs/screenshots/mobile-390-canvas.png" alt="After tapping a chip the sheet drops to a one-line composer and the canvas takes the screen" width="210" />
</p>

<sub>Works on your phone too: the chat docks as a bottom sheet and gets out of the way when a widget lands. Open the demo link on your phone to try it.</sub>

<p>
  <a href="https://opencanvas-production.up.railway.app"><b>▶︎ Try the live demo</b></a>
  &nbsp;·&nbsp;
  <a href="#start-in-60-seconds"><b>🚀 Run it locally</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/ashark-ai-05/opencanvas/stargazers"><b>⭐ Star the repo</b></a>
</p>

</div>

---

## Why a canvas

Chat is a stream. The things you actually want from a model are not.

<p align="center">
  <img src="docs/why-canvas.svg" alt="Left: a chat transcript scrolling endlessly with the one useful line buried in it. Right: the same prompt on OpenCanvas, where a chart, a table and a kanban land side by side and the chat shrinks to one line." width="100%">
</p>

The model never prints the answer. It calls `place_widget` with a typed payload, a schema checks it, tldraw draws it. Answers become objects you can drag, pin, link and export. The chat shrinks to one line. The canvas remembers everything across conversations.

---

## Start in 60 seconds

```bash
npx opencanvas      # Node 24+. Installs to ~/.opencanvas/app and opens http://127.0.0.1:3457
```

| Other ways in | |
|---|---|
| **Docker** | `docker run --rm -p 127.0.0.1:3457:3457 -v opencanvas:/root/.opencanvas ghcr.io/ashark-ai-05/opencanvas` |
| **Desktop app** | macOS, Windows and Linux installers on the [latest release](https://github.com/ashark-ai-05/opencanvas/releases/latest). Unsigned for now: on macOS run `xattr -dr com.apple.quarantine /Applications/OpenCanvas.app` once. |
| **From source** | `git clone https://github.com/ashark-ai-05/opencanvas.git && cd opencanvas && pnpm install && pnpm start` |

One process, one port, no `.env` needed. **Already have a model?** On first run OpenCanvas picks it up automatically: an `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` or `OPENROUTER_API_KEY` in your environment, or a running Ollama. Otherwise connect one later in **Settings** ([Pick a model](./docs/guide.md#pick-a-model)). Prefer the desktop app? `pnpm electron:dev`. Hacking on the UI with hot reload? `pnpm dev`.

**No API key? Start typing anyway.** Timers, checklists, reminders, events, notes, arithmetic and unit conversions are recognised as you type and placed on Enter, with no model call at all. This is an unedited recording of a fresh install:

<p align="center">
  <img src="docs/first-run.gif" alt="A fresh OpenCanvas with no API key. Typing '25 min focus', 'standup tomorrow 9am', '12 km in miles' and a checklist places a live timer, an event card, a conversion and a checklist on the canvas. Then a script POSTs this repo's real git log to /v1/canvas/widgets and it appears as a table." width="100%">
</p>

<sub>Recorded with <code>node scripts/record-first-run.mjs</code> against <code>pnpm start</code>. No API key — the fast lane places widgets, the canvas auto-tidies after the first few, and a script POSTs this repo's real <code>git log</code> to <code>/v1/canvas/widgets</code>. The hero GIF above is a scripted dashboard streamed in over the same REST API (<code>scripts/record-demo.mjs</code>), not a live model run.</sub>

---

## What you get

- **Any model, same agent.** Anthropic, OpenAI, Gemini, Groq, OpenRouter, or Ollama for fully offline. One tool-calling loop for all of them.
- **15 typed widget kinds**, from Vega-Lite charts and kanbans to live timers and sandboxed HTML. Adding one is a schema and a component; the model picks it up from the tool description.
- **The model grows its own toolbox.** It can register new widget kinds mid-conversation and reuse them later. A Python REPL and a JS REPL ship as examples.
- **MCP-native.** Point it at your filesystem, GitHub or Jira through any MCP server. Works with every provider, not just Claude.
- **Memory that compounds.** Every conversation indexes into a local SQLite + sqlite-vec store. `⌘K` finds any widget from any chat, weeks later.
- **Drive it from anywhere.** A REST API and SSE bus let cron jobs, scripts and other agents place widgets on your canvas.
- **Yours.** Binds to `127.0.0.1`, token-guarded routes, null-origin sandboxes for model-written HTML, no telemetry. [Threat model](./SECURITY.md).
- **Canvas that keeps itself neat.** After the first few widgets the layout auto-tidies; click the widget count (or `/tidy`) anytime. Wide tables get a full row.

<p align="center">
  <img src="docs/widgets.png" alt="Six OpenCanvas widgets: a Vega-Lite bar chart, a kanban board, a table, a running pomodoro timer, a TypeScript code block and a sandboxed HTML embed, all rendered on the dark canvas." width="100%">
</p>

*Six of the 15 built-in widget kinds. Each is a schema plus a React component; the model learns them from the tool description.*

### Sibling project: mcp-screen

**Your terminal agent can finally show you things, and you can point back.** [mcp-screen](https://github.com/ashark-ai-05/mcp-screen) takes the canvas idea and hands it to the agent you already run. One command opens a browser tab next to Claude Code, Codex or opencode:

```bash
claude mcp add screen -- npx mcp-screen
```

From then on the agent puts charts, diffs, flow diagrams, log tails and plans on the screen as real widgets instead of ASCII. Circle the bar that looks wrong, type "why?", and the agent reads exactly what you circled. When it needs a decision, `ask_user` shows choice cards you click rather than a numbered list to type back. MCP Apps that would land in a terminal as a wall of JSON render in a null-origin sandbox. Agents glide across a live map of your repo as they edit it. Local, token-guarded, no API keys.

| You want… | Use |
|---|---|
| A full chat-plus-canvas workspace with any model, memory, a KB and schedules | **OpenCanvas** (this repo) |
| A screen your existing terminal agent draws on, and that you can draw back on | **[mcp-screen](https://github.com/ashark-ai-05/mcp-screen)** |

mcp-screen reuses OpenCanvas's event bus, widget-registry and sandbox designs, without tldraw or a chat UI of its own. Scripts and agents can also draw on OpenCanvas directly: `POST /v1/canvas/widgets` ([API reference](https://ashark-ai-05.github.io/opencanvas/api.html)).

---

## Go deeper

| I want to… | Read |
|---|---|
| Configure providers, MCP servers, plugins, the REST API | [docs/guide.md](./docs/guide.md) |
| Browse every endpoint | [API reference](https://ashark-ai-05.github.io/opencanvas/api.html) |
| Understand how the agent and canvas fit together | [docs/plans/unified-agent.md](./docs/plans/unified-agent.md) |
| See how instant widgets work without a model | [docs/plans/fast-lane-intent.md](./docs/plans/fast-lane-intent.md) |
| Host my own public demo in ten minutes | [docs/deploy-railway.md](./docs/deploy-railway.md) |
| Contribute a widget kind or fix a bug | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Report a vulnerability or read the security model | [SECURITY.md](./SECURITY.md) |
| See what changed | [CHANGELOG.md](./CHANGELOG.md) · [Discussions](https://github.com/ashark-ai-05/opencanvas/discussions) |

---

<div align="center">

If this is the direction you want AI tools to go, **[star the repo](https://github.com/ashark-ai-05/opencanvas/stargazers)**. It's how other people find it.

[MIT](./LICENSE) · built with tldraw, Hono, SQLite and the Vercel AI SDK

</div>

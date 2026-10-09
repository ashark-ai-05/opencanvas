<div align="center">

<img src="build/icons/icon-256.png" alt="OpenCanvas" width="104" height="104" />

# OpenCanvas

### Stop reading AI replies. Watch them assemble on an infinite canvas.

Ask a question and get a chart, a table and a kanban side by side, each one a real widget you can drag, pin and keep. Any model, including local, running on your machine under MIT.

[![ci](https://github.com/ashark-ai-05/opencanvas/actions/workflows/ci.yml/badge.svg)](https://github.com/ashark-ai-05/opencanvas/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-775%20passing-2dd4bf)](./docs/guide.md#develop)
[![license](https://img.shields.io/badge/license-MIT-fbbf24)](./LICENSE)
[![stars](https://img.shields.io/github/stars/ashark-ai-05/opencanvas?style=flat&color=a78bfa)](https://github.com/ashark-ai-05/opencanvas/stargazers)

![demo](docs/demo.gif)

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
git clone https://github.com/ashark-ai-05/opencanvas.git && cd opencanvas
pnpm install && cp .env.example .env    # add one provider key, or none
pnpm electron:dev                       # or `pnpm dev` → http://127.0.0.1:3458
```

**No API key? Start typing anyway.** Timers, checklists, reminders, events, notes, arithmetic and unit conversions are recognised as you type and placed on Enter, with no model call at all.

<p align="center">
  <img src="docs/instant-widgets.svg" alt="Typing '25 min focus' into the composer. A chip previews 'Timer 25:00 · Focus', Enter places a live timer on the canvas, and a note reads 'Placed Timer 25:00 · Focus without the model'." width="100%">
</p>

---

## What you get

- **Any model, same agent.** Anthropic, OpenAI, Gemini, Groq, OpenRouter, or Ollama for fully offline. One tool-calling loop for all of them.
- **15 typed widget kinds**, from Vega-Lite charts and kanbans to live timers and sandboxed HTML. Adding one is a schema and a component; the model picks it up from the tool description.
- **The model grows its own toolbox.** It can register new widget kinds mid-conversation and reuse them later. A Python REPL and a JS REPL ship as examples.
- **MCP-native.** Point it at your filesystem, GitHub or Jira through any MCP server. Works with every provider, not just Claude.
- **Memory that compounds.** Every conversation indexes into a local SQLite + sqlite-vec store. `⌘K` finds any widget from any chat, weeks later.
- **Drive it from anywhere.** A REST API and SSE bus let cron jobs, scripts and other agents place widgets on your canvas.
- **Yours.** Binds to `127.0.0.1`, token-guarded routes, null-origin sandboxes for model-written HTML, no telemetry. [Threat model](./SECURITY.md).

<p align="center">
  <img src="docs/widgets.png" alt="Six OpenCanvas widgets: a Vega-Lite bar chart, a kanban board, a table, a running timer, a syntax-highlighted code block and a sandboxed HTML embed, all rendered on the dark canvas." width="100%">
</p>

*Six of the 15 built-in widget kinds. Each is a schema plus a React component; the model learns them from the tool description.*

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

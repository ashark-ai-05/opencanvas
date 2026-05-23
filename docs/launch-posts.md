# Launch posts — ready-to-paste copy

Pre-written launch copy for OpenCanvas v0.1. Tweak as you go; the
bones are here so you don't have to write from a blank page at
midnight before launch.

---

## Hacker News — "Show HN"

**Title (80 char budget):**

> Show HN: OpenCanvas – your local LLM draws typed widgets on a tldraw canvas

**Body:**

```
Hi HN — OpenCanvas is a desktop app I built because I got tired of
scrolling through walls of ChatGPT text to find the one number, table, or
diagram I actually came for. Instead, the agent renders typed widgets on
an infinite canvas: markdown cards, code blocks, tables, charts (Vega-Lite),
kanban boards, calendars, web embeds, sandboxed plugin iframes, and a few
more. You can click, drag, pin, link, and export them.

Everything runs locally:

- BYO model — Claude (direct or via the Agent SDK), OpenAI, OpenRouter,
  Ollama (fully local), Sourcegraph Amp. Six provider adapters.
- BYO MCP servers — Confluence, Jira, filesystem, GitHub, whatever else
  speaks Model Context Protocol. Every LLM provider gets them via tool
  use.
- BYO embedder — bundled ONNX (BAAI/bge-small-en-v1.5, runs offline),
  OpenAI, Voyage, or Ollama.
- A SQLite + sqlite-vec knowledge base every conversation auto-indexes
  back into, so old turns are searchable across all conversations.

Token-authenticated local backend (Hono on :3457), strict CORS, sandboxed
plugin iframes, no telemetry. Single user, runs on your machine.

What's interesting about it:

1. **Widget kinds are typed contracts** between the agent and the
   renderer. The agent calls `place_widget(kind, role, payload)` and the
   dispatcher validates the payload with Zod before tldraw renders it.
   This means new widget kinds can be added (or registered at runtime
   via a plugin) without retraining or fine-tuning anything.

2. **Plugins are sandboxed HTML/JS iframes** with a postMessage prop
   bridge. The `html` widget lets the agent render arbitrary one-shot
   HTML; the `register_widget_kind` agent tool lets it declare a reusable
   plugin kind with its own template and prop schema. There are example
   plugins for a Python REPL (via Pyodide) and a JS REPL.

3. **REST API drives the canvas.** `POST /v1/canvas/widgets` from any
   process renders a widget, so cron jobs, watchers, and external tools
   can draw to the canvas just like the agent does.

Tech: tldraw v3, Hono, Vercel AI SDK, MCP, Electron, Vite, React 19,
better-sqlite3, sqlite-vec, ONNX runtime, framer-motion. ~600 tests
passing, MIT.

GitHub: https://github.com/ashark-ai-05/opencanvas

Would love feedback on the widget-kind model and the security boundary
around plugins — both feel ready but are the parts I'm least sure of.
```

---

## Product Hunt

**Tagline (60 char):** An infinite canvas your local LLM draws on.

**Description (260 char):**

> OpenCanvas turns chat into a canvas. Your LLM renders typed widgets — markdown, charts, kanbans, code, calendars, web embeds, sandboxed plugins — on an infinite tldraw canvas. BYO model (Claude/GPT/Ollama), MCP-native, runs entirely on your machine.

**First comment from maker:**

> Built this over a few months because long chat threads kept burying the
> stuff I actually came for. The agent now writes a one-line answer and
> renders the *real* result as a widget on the canvas — a table, a chart,
> a kanban, a calendar — that I can click, drag, pin, and link.
>
> Everything is local. BYO model (six provider adapters including Ollama),
> BYO MCP servers, BYO embedder. Single-user, MIT, no telemetry.
>
> Happy to answer anything — especially curious what widget kinds people
> would want added next.

---

## Twitter / X thread

**Tweet 1 (hook + image):**

> Built OpenCanvas: an infinite canvas your local LLM draws typed
> widgets on.
>
> Instead of scrolling chat for the one chart you wanted — the agent
> renders the chart. Click, drag, pin, link.
>
> BYO model. MCP-native. Local. MIT.
>
> [og-image attached]

**Tweet 2 (proof):**

> 15 widget kinds: markdown, code, tables, charts (Vega-Lite), kanbans,
> calendars, file trees, web embeds, sandboxed plugin iframes, and more.
> Each is a typed contract — agent calls `place_widget(kind, payload)`,
> Zod validates, tldraw renders.

**Tweet 3 (extensibility):**

> Plugins are sandboxed iframes with a postMessage prop bridge. There's
> a Python REPL (via Pyodide) and a JS REPL example shipped. The agent
> can also call `register_widget_kind` mid-conversation to declare a new
> reusable widget on the fly.

**Tweet 4 (BYO + privacy):**

> Six LLM providers (Claude via Agent SDK or direct, OpenAI, OpenRouter,
> Ollama, Amp). BYO MCP servers. BYO embedder (bundled ONNX runs
> offline). SQLite + sqlite-vec KB every conversation indexes back into.
> No telemetry. Token auth on the local backend.

**Tweet 5 (call to action):**

> Code's MIT, ~600 tests passing. Would love feedback on the widget-kind
> contract and the plugin security model.
>
> https://github.com/ashark-ai-05/opencanvas

---

## Reddit (/r/LocalLLaMA, /r/ChatGPTPro, /r/SideProject)

**Title:** OpenCanvas — open-source infinite canvas where your local LLM renders typed widgets (charts, kanbans, code, web embeds…)

**Body:**

```
I open-sourced something I'd been building for a while: instead of one
long chat stream, the agent renders typed widgets on a tldraw canvas as
it researches. Markdown, code, tables, charts, kanban boards, calendars,
web embeds, sandboxed plugin iframes, and a few more.

Local. BYO model (Claude / GPT / Ollama / OpenRouter / Amp). MCP-native
so any Model Context Protocol server drops in (Confluence, Jira,
filesystem, GitHub, etc.). SQLite KB every conversation indexes back into.
Single-user, MIT.

GitHub: https://github.com/ashark-ai-05/opencanvas

Curious what widget kinds the community would want added — feedback
welcome.
```

---

## LinkedIn / dev.to long-form (optional, for the launch week)

**Title:** Why I built OpenCanvas — an infinite canvas where your local LLM renders widgets instead of text

**Outline:**

1. The problem: scrolling through walls of chat to find the one
   *artifact* you actually came for.
2. The shift: treating LLM output as **structured widgets** instead of
   markdown. Typed contracts (kind + role + payload).
3. The build: tldraw + Hono + AI SDK + MCP + Electron. The
   widget-kind catalog. Sandboxed plugin iframes.
4. The security model: token-authenticated local backend, strict CORS,
   no-origin sandbox for plugins, opt-in proxy for null-origin fetches.
5. What's next: signed installers, plugin marketplace, multi-canvas
   linking.

(Draft the long-form post the week before launch — too much to write
ahead of time, but the outline is here.)

---

## Image assets

- `app/public/og-image.png` (1200×630) — used as the OG/Twitter card.
  Generated from `build/og-image.svg` via `pnpm icons:og`.
- `build/icons/icon-512.png` — square icon for Product Hunt and
  LinkedIn posts.
- `docs/demo.gif` — short auto-loop showing widget rendering.
  Replace with a 30–60s screen recording for launch week (Loom or
  screen.studio export to .mp4 → upload to GitHub Releases as a
  download or embed).

## Cadence

A reasonable launch sequence:

| Day | Channel |
|-----|---------|
| Mon  | Soft-launch to ~10 friends, fix anything that breaks |
| Tue  | HN "Show HN" first thing morning UTC |
| Tue  | Twitter/X thread same time, link to HN comments |
| Wed  | Product Hunt (PH cycles 00:01 PT, so schedule for Tue night) |
| Thu  | Reddit posts to /r/LocalLLaMA + /r/SideProject + /r/ChatGPTPro |
| Fri  | dev.to long-form retrospective |

Reply to every comment in the first 24h of each post. Most launches
live or die on whether you're around to engage in the comments.

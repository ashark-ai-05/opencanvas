# PRODUCT.md: product-owner critique log

Positioning: **opencanvas is the full chat-plus-canvas app**. Its sibling
[mcp-screen](https://github.com/ashark-ai-05/mcp-screen) is the lightweight screen that
terminal agents (Claude Code, Codex, opencode) draw on. opencanvas should win on the
first-run "watch it assemble" moment, so the two never compete for the same user.

## Round 1 (2026-10-16)

**First 60 seconds, as a new user (fresh `$HOME`, no keys):**
1. README → clone → `pnpm install` → `cp .env.example .env` → `pnpm electron:dev` or
   `pnpm dev`. That's four steps, two processes and two ports (3457 + 3458), and a `.env` you don't need.
2. The page loads with three sample widgets and a 3-step tour. Good.
3. Type `25 min focus` + Enter. The timer **lands collapsed as a 44px header with no
   clock**: the three welcome samples counted toward the "collapse after 3 widgets" rule.
   The headline no-key feature looked broken.
4. Paste or type quickly and hit Enter within ~120ms: the fast-lane debounce hadn't fired, so
   the text went to the model instead.
5. Ask a real question with no key: a red toast says `SDK error: authentication_failed` and
   the chat shows an empty assistant bubble. It reads like a crash.
6. The console shows 16 CSP errors on every load (tldraw fonts blocked).

**Reasons to star or share:** the "replies assemble as widgets" hook, the live demo, instant
widgets with no key, a genuinely polished dark UI and a real threat model.

**Weakest part:** the very first interaction. The two things a new user does first (type
an instant widget, ask a question) both failed visibly.

**Built this round:**
- `pnpm start`: one process and one port with no `.env`. It builds the UI on first run, serves UI
  and API on 127.0.0.1:3457, and opens the browser. The SPA gets its auth token through a
  `<meta>` tag that is only injected for loopback `Host` headers (DNS-rebinding safe) and never
  in demo mode.
- The first real widget opens expanded: welcome samples are tagged `meta.seed` and excluded
  from the auto-collapse count.
- Enter before the debounce fires now classifies synchronously (`resolveNow`), so paste + Enter
  places the widget.
- "No model connected yet" inline card replaces the raw auth toast. It offers one-click
  instant-widget chips, *Connect a model* (Settings) and the provider guide.
- CSP allows tldraw's font CDN, which takes console errors to 0.
- Fixed the broken `#install` README anchor in the capacity notice.

## Round 2 (2026-10-16)

**Critique after round 1.** Install and first contact work now, but the README still sells with a
scripted dashboard GIF, and nothing shows the claim that matters most to a skeptic: *does
it really work with no key?* While recording an honest first-run GIF, three more defects
showed up that would ruin any demo:
- `checklist: record the GIF, write the README, ship` went to the model, because the word "write"
  marked it as a writing task and overrode the explicit `checklist:` lead. `todo: buy milk`
  (one item) never committed at all, so it needed Tab.
- The 4th widget of any answer was born collapsed (threshold 3). A model answer with
  chart + table + kanban + note ended as three cards and a stub. That breaks the
  "watch it assemble" hook itself.
- New widgets landed **underneath the floating chat panel** on the right.

**Reasons to share now:** a 34-second, unedited, no-key recording, plus "your scripts draw
here too" shown with this repo's real `git log`.

**Weakest part:** it's still a destination app. Recording also showed the header status
reading `claude-agent-sdk` with a green dot when no model is authenticated (honesty gap).

**Built this round:**
- `docs/first-run.gif` + `.mp4` and a reproducible `scripts/record-first-run.mjs` (real app,
  no mocks, real git data), in the README with an honest caption that also labels the hero GIF as scripted.
- Classifier: a `todo:` / `checklist:` lead keyword now commits on its own and outranks task
  verbs and a stray "demo" meeting word. "write a todo app" and "build a checklist component"
  still go to the model (tests added).
- Auto-collapse threshold 3 → 8.
- `placementBounds()`: new widgets avoid the floating chat when it's docked right.
- Header model badge no longer wraps onto two lines.
- Fixed round 1's CI break (missing `.js` extensions in a new test import).

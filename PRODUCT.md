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

## Round 3 (2026-10-16)

**Critique after round 2.** A new user now gets a working first minute, but two trust gaps remain:
- The header keeps a **green dot** next to `claude-agent-sdk` even after the model has just
  rejected the request, so the app tells you it's fine when it's not.
- In `pnpm start` mode the backend sends **2.5 MB of uncompressed JS** with no caching, so
  every reload pays the full cost.
- The README never answers the obvious question for anyone who found mcp-screen first:
  "which one do I want?"

**Reasons to star or share:** an honest no-key GIF, one command, zero console errors, and a
clear split from mcp-screen.

**Weakest part (still):** opencanvas is a destination app, and install still needs clone + pnpm
(there's no npx or published Docker image yet). See the next ideas in the final report.

**Built this round:**
- Honest model badge: it turns amber and reads "· not connected" after a keyless or auth failure, and
  clicking it opens Settings. Closing Settings resets it; it goes back to green after a clean turn. Demo
  mode is unaffected.
- gzip plus `immutable` caching for `/assets` (SSE under `/v1` deliberately untouched): **2.53 MB →
  0.77 MB** of JS on the wire.
- README section "OpenCanvas or mcp-screen?", with a table and the REST drawing path.
- CHANGELOG `[Unreleased]` written up.

## Round 4 (2026-10-16): type safety, instant-widget gaps, layout

**Critique.** After round 3 the first minute works, but replaying it with a critical eye turns up:
- `remind me to call mom tomorrow` only showed a ghost chip, so Enter asked a model you don't
  have. "remind me" is the most natural instant-widget phrase there is.
- Cards ignored their content. A one-item reminder was a 260px box, a 6-row REST table was
  clipped to 3 rows, and a wide table in the right-hand column slid **under the chat**.
- The welcome card clipped its own last two lines (77px of hidden text) on a fresh install.
- The arrow in "12 km → mi" fell back to a thin system font. Google's `latin` subset of
  Geist/Inter has ↑ and ↓ but not →. It vanished in the GIF.
- The app's own TypeScript had 6 errors that CI never saw.

**Built:**
- `remind me …` / `reminder: …` commit on their own; "call" or "lunch" inside a reminder no longer
  splits the vote with "event". Questions about reminders still go to the model.
- `contentSize()`: tables size to their rows (all visible up to 14, then scroll) and columns;
  task lists size to their items. Wide cards are clamped to the area left of the chat.
- The welcome copy was trimmed so it fits (the gear tip lives in the tour).
- A 9 KB self-hosted Inter arrows subset (OFL), registered per weight under both families. A
  first attempt with a `100 900` weight range hijacked weight-650 titles into Noto Sans; QA caught it
  via CDP platform-font inspection, and it was fixed with discrete weights.
- All 6 app type errors fixed (`Conversation.name` → `title` in the share title, which was a real bug:
  shares with no text always fell back to "Shared OpenCanvas"). `pnpm typecheck:app` is now a CI step.

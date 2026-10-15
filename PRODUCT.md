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

## Round 5 (2026-10-16): the model you already have, a fast first answer, a sturdy token

**Critique.** The most common new user already has an `OPENAI_API_KEY` exported or Ollama
running, and we ignored both. We defaulted to `claude-agent-sdk` and showed "not connected" on
the first question. Meanwhile that first question waited several seconds on "Searching your
knowledge base" while the ONNX embedder loaded. And the round 2 one-off backend failure was still
unexplained.

**Built:**
- `src/config/autodetect.ts`: first boot only, it detects an env key (fixed order) or Ollama via
  `/api/tags`, skips embedding models, writes an `auto` profile without the key and keeps
  `claude-sdk` as a second profile. It never touches an existing config, and an explicit
  `OPENCANVAS_LLM_PROVIDER` wins.
- Background warm-up of the bundled embedder right after `listen` (local embedders only, so no paid
  calls; off in tests and with `OPENCANVAS_NO_WARMUP=1`). The boot log says `local search ready (~1.6 s)`.
- Flaky test investigation: not reproduced in 10 full backend runs (including 6 in parallel alongside a UI
  build). The one shared mutable resource the suite and a running server both touch is
  `~/.opencanvas/auth-token`, and `getAuthToken()` was non-atomic: a reader could see a half-written
  file, judge it invalid and overwrite it, which would silently invalidate a running server's token. It
  now writes temp → `link()` (no clobber) → re-reads the winner, mode 0600. The new test spawns 6
  concurrent first boots and checks they agree. The suite no longer touches the real `~/.opencanvas`.
  Honest status: hardened the likeliest shared-state race; the original failure is unidentified (that run's
  log wasn't kept).

## Round 6 (2026-10-16): one-command install, ready but not published

**Critique.** The product still asks for clone + pnpm. Cate and friends win the install race.
The research lesson was "turn opencanvas into the screen your agents draw on"; the complementary
lesson for install is "make trying it one command". Publishing is irreversible and needs Krunal's OK,
so everything is prepared and verified, not shipped.

**Built (not published):**
- `launcher/` — a zero-dependency npm package named `opencanvas`. `npx opencanvas` clones into
  `~/.opencanvas/app`, installs via corepack pnpm and runs `pnpm start`. Flags: `--update`
  (fast-forward + rebuild), `--dir`, `--dry-run`, and any `pnpm start` flag. Verified end-to-end
  against a real clone of this repo (health 200 on :3460). Dry-run plan is unit-tested.
- `Dockerfile.local` — a separate file from the Railway demo Dockerfile, so the public demo is
  untouched. Auth ON, no demo mode, volume for `~/.opencanvas`, Ollama via `host.docker.internal`,
  healthcheck. Built and run: first-run auto-pick with `GEMINI_API_KEY`, search warm-up, token
  meta for loopback, 401 on mutating routes without a token, Playwright load with 0 console errors.
  Image size ≈ 3 GB (better-sqlite3 + onnxruntime + the SPA).
- README has a "Coming soon" disclosure with the exact commands; CHANGELOG notes them as unpublished.

**Highest-impact next (still open):**
1. **Publish** `npx opencanvas` to npm and `ghcr.io/ashark-ai-05/opencanvas` (needs OK).
2. **Auto-tidy after the first 3–4 widgets** so a fresh canvas doesn't look scattered (the GIF
   still needs a manual fit-to-canvas).
3. **Defer the KB search until the embedder is ready**, so the first chat turn doesn't show
   "Searching your knowledge base…" while nothing is indexed yet.

## Round 7 (2026-10-16): auto-tidy + no more "Searching…" on an empty KB

**Critique after round 6.** The first minute still has two visible papercuts:
1. Place a timer, a reminder and a conversion in quick succession and the canvas looks
   like a pile — the welcome seeds stayed in role slots, new cards landed wherever the
   template put them, and nothing ever arranged them. The "watch it assemble" moment
   ends with a mess that needs a manual `/tidy` or fit-to-canvas.
2. Ask anything on a fresh install and the chat spends a beat on **"Searching your
   knowledge base…"** even when KB = 0 chunks and the embedder isn't ready yet. That
   spinner is a lie: there is nothing to search.

**Reasons to share now:** a fresh canvas tidies itself after the first couple of widgets
into a readable 2-column grid (titles stay whole at 320px), and the first chat turn no
longer pretends to search an empty index.

**Weakest part:** the first-run GIF still shows the pre-tidy scattered layout, and
publishing (`npx` / Docker) is still waiting on OK. The auto-tidy flag is once-per-canvas,
so a long session that later gets messy still needs `/tidy`.

**Built this round:**
- `app/src/canvas/tidy.ts`: shared tidy used by `/tidy`, welcome settle, and a once-per-
  canvas auto-tidy. Grid columns are decided from **screen** width (not the zoomed page
  viewport — that was collapsing to one column after welcome zoomToFit). Cards stay at
  320px so titles don't truncate. Welcome settle waits past the dispatcher's 700ms burst
  so role-slot relayout can't undo the grid; later bursts reuse the same grid once the
  auto-tidy flag is set.
- KB search skipped when `totalChunks === 0` or `/v1/health.searchReady === false`.
  Bundled ONNX embedder exposes `isReady()`; health reports `searchReady`.
- Fast-lane roles: time/tasks → `detail`, key-value/sticky → `related`, else `primary`
  (spreads the grid instead of stacking every chip in `primary`).

## Round 8 (2026-10-16): first-run GIF shows the tidy

**Critique after round 7.** Auto-tidy and the empty-KB skip are real, but the README still
sold yesterday's experience: the first-run GIF ended with a manual fit-to-canvas and never
showed the canvas arranging itself. A skeptic watching the GIF wouldn't see the two highest-
impact fixes from round 7. `/tidy` also quietly fell back to role slots (no `forceGrid`), so
typing `/tidy` after a REST burst could undo the grid the auto-tidy had just made.

**Reasons to share now:** the honest first-run recording ends on a tidied 2-column canvas with
this repo's live `git log` as a table, and the caption names auto-tidy.

**Weakest part:** publishing is still blocked on OK; the GIF is ~48s / ~2.6 MB and still
overlays captions rather than letting the UI speak alone; once-per-canvas auto-tidy means a
long messy session still needs `/tidy`.

**Built this round:**
- Re-recorded `docs/first-run.gif` / `.mp4` with welcome settle, auto-tidy after the fast-lane
  burst, `/tidy` after the REST table, and a README caption that names the behaviour.
- `/tidy` now always uses `forceGrid` so it matches auto-tidy and welcome settle.

## Round 9 (2026-10-16): soft re-tidy + wide tables

**Critique after round 8.** Auto-tidy fires once and then stops caring. Drop a REST table and
four more chips after the first tidy and the new cards land wherever — the once-flag made the
canvas look intentional for thirty seconds and scattered again. Meanwhile `/tidy` and auto-tidy
forced every card (including 520px tables) down to a single column width, so the git-log table
in the first-run GIF had truncated commit messages — the one widget a developer would actually
read.

**Reasons to share now:** the canvas keeps itself tidy as it grows (soft re-tidy every +4
widgets, camera only moves if content overflows), and tables/kanban get a full grid row so
columns stay readable.

**Weakest part:** soft re-tidy is silent (no toast), so a user mid-drag could still feel a
ghost rearrange; publishing still needs OK; the share/star path from the app itself is thin.

**Built this round:**
- Soft re-tidy: after the first auto-tidy bookmark, growing by `SOFT_RETIDY_GROWTH` (4) triggers
  another force-grid tidy. No camera yank unless the new grid overflows the viewport
  (`fitIfOverflow`).
- Wider dense grids: 3 columns at 340px once there are 7+ widgets; 2 columns at 400px before
  that. Tables/kanban/composite/code-block/file-tree take a full row at `gridTotalW`.
- `fitLeftOfChat`: frames into the area left of the floating panel so the right column isn't
  hidden under chat after zoom.

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

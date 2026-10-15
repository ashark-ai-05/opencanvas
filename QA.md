# QA.md: per-round QA log

Environment: Linux box, Node 24.22, pnpm 10.34.5, Playwright 1.64 (Chromium headless, 1440×900),
fresh `HOME` so the run looks like a brand-new user with no keys and no `~/.opencanvas`.
The scripts live outside the repo in `/workspace/qa-oc/` (`qa.mjs`, `t.mjs`, `chip.mjs`).

## Round 0 (baseline, before changes)
- Tests: backend 397 passed / 2 skipped, app 378 passed → **775** ✅. `pnpm typecheck` clean.
- `pnpm dev` (two ports): load 2.5s (Vite dev, unbundled).
- Console: **16 CSP errors** (tldraw fonts from cdn.tldraw.com blocked by `font-src`).
- Bug: `25 min focus` + Enter → timer placed **collapsed (h=44)**, no clock visible.
- Bug: fill + immediate Enter → sent to model instead of the fast lane (120ms debounce race).
- Bug: keyless question → toast `SDK error: authentication_failed` + empty assistant bubble.
- Bug: capacity notice links to a non-existent README anchor `#install`.

## Round 1
- Tests: backend **401** passed / 2 skipped, app **382** passed → **783** ✅ (8 new:
  seed-aware collapse, no-model error matcher, loopback-only token injection). Typecheck clean.
- `pnpm start` from a fresh HOME: first-run UI build about 10s, then the backend serves on :3457.
- Playwright on :3457 (production bundle): DOMContentLoaded **≈0.33s**, ready <3s, JS transfer
  2.5 MB. **Console errors: 0**, no 4xx or 5xx responses.
- `25 min focus` → timer 320×200, shows 25:00 with play/reset ✅
- Immediate Enter (no debounce wait) on `25 min focus`, `12 km in miles` and `standup tomorrow 9am` all place locally ✅
- Keyless "what is the weather" → "No model connected yet" card, no red toast ✅; clicking the
  `checklist: milk, eggs` chip then Enter → a tasks widget is placed ✅
- Known (not fixed): `todo: ship the demo` (one item) only reaches "ghost" (needs Tab), and so does
  `remind me to …`. Recorded as a classifier gap.

## Round 2
- Round 1 CI **failed** at typecheck: the new test imported without `.js` (NodeNext). Locally I
  had run vitest and the app tsconfig but not `pnpm typecheck` after adding the test. Fixed. Lesson:
  run the exact CI sequence (`typecheck → test → app tests`) before every push.
- Tests: backend 401 passed / 2 skipped, app **388** → **789** ✅. `pnpm typecheck` clean, app tsconfig
  back to its 6 pre-existing errors (round 2 briefly added 4; fixed).
- One backend run showed `1 failed` under heavy box load (a parallel UI build plus recording); two reruns
  came back 401/401. Logged as a possible flake under CPU contention.
- Playwright (fresh context, :3457): 0 console errors, 0 failed requests. `todo: buy milk`,
  `todo: ship the demo` and `checklist: milk, eggs, bread` all place locally ✅
- Recording QA (frame-by-frame review of first-run.mp4): timer ticks, event "Sat 17 Oct, 09:00"
  is correct for "tomorrow", conversion 7.46 mi is correct, and the REST table shows the real commits.
- Known: the `→` glyph in the conversion card *title* renders blank in headless Linux Chromium
  (font coverage), while the body is fine. The REST-placed table is 200px tall, so only 3 of 6 rows show
  without scrolling.
- Perf: DOMContentLoaded 0.3–2.1s on the production bundle (the high end was under box load), JS 2.5 MB.

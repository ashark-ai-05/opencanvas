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

## Round 3
- Ran the exact CI sequence locally: `pnpm typecheck` ✅ → backend **401** passed / 2 skipped →
  app **389** passed → **790** ✅. `pnpm audit --prod --audit-level=moderate` exit 0.
- Round 2 CI on main: **success**.
- `pnpm start --rebuild` from a fresh HOME. curl checks: `/assets/vendor-tldraw-*.js` is 983 KB raw and
  292 KB gzipped, with `cache-control: public, max-age=31536000, immutable`. `/v1/health` 200. A forged
  `Host: evil.com` gets **no** token meta tag ✅
- Playwright: JS transfer **771 KB** (was 2.53 MB). Load 0.39–0.64s across 3 runs (one 8.5s outlier
  while the box load average was about 8, not reproducible). 0 console errors.
- Keyless "explain the CAP theorem": notice after about 1.0s, badge `claude-agent-sdk · not connected` in
  amber ✅. Screenshot: /workspace/qa-oc/r3-badge.png.
- Observed: the first question in a brand-new HOME spends several seconds on "Searching your
  knowledge base" while the bundled ONNX embedder warms up. Not fixed yet.

## Round 4
- Exact CI sequence: `typecheck` ✅ + **new** `typecheck:app` ✅ → backend → app. Tests:
  backend 401+ (grew with later rounds) / app **397** with the new contentSize + remind-me cases.
- Playwright: `remind me to call mom tomorrow` and `remind me to stretch at 3pm` place on Enter ✅
- REST 6-row table: height 306, `scrollHeight - clientHeight = 0` (no clipping) ✅. One-item reminder
  is 116px tall (was 260).
- Arrow glyph (CDP platform fonts): after the discrete-weight fix, the conversion title is Inter
  for all 10 glyphs including U+2192. The earlier weight-range attempt had hijacked to Noto Sans.
- CI on main after push: **success**.

## Round 5
- Autodetect unit tests: 5 cases (env order, Ollama pick, skip-existing, no-key-in-file, explicit
  env wins). Auth race: 6 concurrent first boots → one token, mode 0600, no `.tmp` left.
- Flake hunt: 10 full backend suite runs (6 parallel + UI build) → 410/410 each time. No flake
  reproduced; the auth-token race was hardened anyway.
- Fresh `HOME=/tmp/nu3 pnpm start --rebuild`: boot log shows `local search ready (1677 ms)`.
  First keyless question → "No model" notice in **889–1402 ms** (was multi-second KB stall before).
- Docker (from round 6 prep) with `GEMINI_API_KEY=…`: boot log
  `first run: using gemini (gemini-flash-lite-latest) because GEMINI_API_KEY is set`.

## Round 6
- `npx`-style launcher dry-run plan unit-tested (2 cases). Live run: clone → install → start on
  :3460, `/v1/health` 200.
- `Dockerfile.local` build success on second try (first hit a transient Debian 500). Run:
  auth on, no demo, loopback token meta present, POST without token → 401, search warm-up
  1462 ms, Playwright load 356 ms / 0 console errors. Image 3.02 GB.
- Round 5 push CI: **success**. Local exact CI sequence for this round: typecheck ✅, typecheck:app ✅, backend 410 passed / 2 skipped, app 397 → **807** ✅, audit exit 0.
- Not published: no `npm publish`, no `docker push`, Railway demo not redeployed.

## Round 7
- Exact CI sequence: `typecheck` ✅ → `typecheck:app` ✅ → backend **411** passed / 2 skipped →
  app **400** passed → **811** ✅. `pnpm audit --prod --audit-level=moderate` exit 0
  (2 moderate ignored, same as prior rounds).
- Playwright `/workspace/qa-oc/r7.mjs` (fresh context, flags cleared, :3457 production bundle):
  - Welcome settle → 2-column grid (Welcome + sticky | Try these); sticky no longer under chat.
    Screenshot: `/workspace/qa-oc/r7-welcome.png`.
  - After `25 min focus`, `remind me to call mom tomorrow`, `12 km in miles` → auto-tidy into
    a 2×3 grid at zoom ≈101%. All six cards share two x-columns; 12 km card stays in grid.
    Screenshot: `/workspace/qa-oc/r7-tidied.png`.
  - `explain the CAP theorem`: **0** `/v1/search` POSTs, **0** "Searching your knowledge base"
    labels, **0** console errors. Screenshot: `/workspace/qa-oc/r7-ask.png`.
- New unit tests: `__tests__/app/tidy.test.ts` (3), `__tests__/embedder-ready.test.ts` (1).
- Known: auto-tidy is once per canvas (`opencanvas:auto-tidied:v1`); later mess still needs `/tidy`.
  First-run GIF not yet re-recorded with the new tidy behaviour.

## Round 8
- Exact CI sequence local: typecheck ✅, typecheck:app ✅, backend **411** / 2 skipped, app **400**
  → **811** ✅, audit exit 0.
- Round 7 CI on main (`b5a6608`): **success**.
- Re-recorded first-run with Playwright + ffmpeg against `pnpm start` on :3457. End frame shows
  "Tidied 8 widgets", 2-column grid including the live `git log` table, chat minimized for the
  final beat. GIF ≈ 2.6 MB / ~48s. Frame check: `/tmp/fr/end.png` (box-local).
- `/tidy` forceGrid verified via recording toast "Tidied 8 widgets" and end-frame layout.
- Not published: no npm / Docker / Railway changes.

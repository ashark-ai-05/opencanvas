# Plan 5 — Manual Smoke Tests

Run these against a live backend (`pnpm backend`) and Vite app (`pnpm dev`).
For each, observe the chat panel + canvas and confirm the expected behavior.

## 1. Pure chat, no tools

- Type: `say hi`
- Expected:
  - Streaming text reply (one short greeting).
  - **No** tool-call indicators in the chat.
  - **No** new widgets on the canvas.

If a tool-call indicator appears, the system prompt isn't discouraging
gratuitous tool use — re-tune the prompt before shipping.

## 2. Lookup + render

- Pre-condition: at least one indexed source. Run
  `pnpm tsx scripts/cli.ts index --source <id>` first if needed.
- Type: `tell me about TICKET-101` (or any content you know is indexed).
- Expected:
  - Tool-call indicators for `search_kb` (and likely `fetch_result`,
    then `place_widget`).
  - At least one new widget on the canvas — kind matches what the
    indexed source returned (ticket card / markdown / etc.).
  - Streaming text reply that references the placed widget.

## 3. Multi-tool investigation

- Type: `walk me through how auth works`.
- Expected:
  - 2+ widgets land on the canvas (e.g., one markdown overview + one
    code-block with the relevant function).
  - Possibly a `link_widgets` arrow connecting them.
  - Text reply references both placements.

## 4. Cancel mid-loop

- Ask a complex question (#2 or #3 are good candidates).
- While the loop is iterating (you should see tool-call indicators
  appearing one by one), click Stop.
- Expected:
  - Loop terminates at the next boundary; no further tool-call
    indicators appear.
  - Widgets already placed remain on the canvas.
  - No uncaught errors in the browser console.
  - Backend log shows clean SSE close, no stack traces.

## 5. Iteration cap

- Ask a deliberately hard, broad question that the agent can't answer
  in 10 calls (e.g., `enumerate every TODO comment in every indexed
  file and place a card for each`).
- Expected:
  - Loop hits `maxTurns: 10` and terminates.
  - Chat shows the partial work + an error toast referencing
    "exceeded 10 iterations".
  - Backend log shows the SDK `error_max_turns` result subtype.

## 6. Cache_control + maxOutputTokens (T20 follow-ups)

T20 flagged two SDK concerns to verify in real integration:

- **Cache_control validation**: wiring `mcpServers` may resurface the
  cache_control validation bug that T20's predecessor fixed by setting
  `tools: []`. Watch the backend log for `cache_control` errors during
  tool-heavy turns. If they appear, the `mcpServers` wiring is
  triggering dynamic context blocks somehow — try setting
  `enableFileCheckpointing: false` (already done) tighter, or switch to
  a different tool surface mode.
- **`maxOutputTokens` runtime acceptance**: this option is set to 8192
  but isn't an explicit field on the SDK's `Options` JSDoc — likely
  passthrough. If responses are getting truncated unexpectedly, check
  the SDK's accepted options list and rename if needed.

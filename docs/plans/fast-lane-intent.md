# Fast lane: local intent → instant widget

*Design spec. Status: implemented 2026-09-26.*
*Inspired by [anishfn/shapeshift](https://github.com/anishfn/shapeshift) (MIT): "the model decides, code computes."*

## 1. Problem

Every prompt in OpenCanvas goes through the full agent loop. For utility
requests ("25 min timer", "buy milk, eggs, bread", "standup with Priya
tomorrow 10am") that means:

- seconds of latency for a widget whose contents are fully determined by the
  text;
- one of the public demo's five hourly messages spent on a timer;
- a failure mode on small models, which narrate the JSON instead of calling
  `place_widget` (the Gemini pomodoro regression);
- nothing works at all without a provider key.

The dispatcher already accepts typed directives from three producers (model,
slash commands, REST). This spec adds a fourth: a client-side classifier plus
deterministic parsers that turn recognised text into a `place` directive with
no model call.

## 2. Goals and non-goals

**Goals**
- Recognise a small, high-confidence set of utility intents as the user types
  and show a live, non-flickering preview chip in the composer.
- Enter places the widget locally in under 50 ms. Shift+Enter (or an explicit
  chip) sends the same text to the model instead.
- Zero new network calls. Works offline and with no provider configured.
- Every parser is a pure function with tests. Misclassification must never
  block the normal path: if the fast lane is wrong, one keystroke escapes it.

**Non-goals**
- No hosted classifier (shapeshift's Jev). The keyword classifier is the
  primary and only classifier in v1. A provider-backed classifier can be a
  later, opt-in refinement.
- No new widget kinds. v1 maps onto existing kinds only.
- No auto-arrange, no template switching (that is direction 2, separate spec).
- No value extraction by a model. Dates, durations, numbers and units come
  from code.

## 3. User experience

### 3.1 States (ported from shapeshift's `decide.ts`)

| State | Composer shows | Enter does |
|---|---|---|
| `input` | nothing new | sends to model (unchanged) |
| `ghost` (confidence 0.4–0.7) | faint chip: "Timer 25:00 · ⇥ to place instantly" | sends to model |
| `choose` (two intents within 0.15) | two chips "Timer / Reminder", ←→ to pick | sends to model unless a chip is picked |
| `committed` (≥0.7, or challenger won twice, or user picked) | solid chip: "↵ places Timer 25:00 · ⇧↵ asks the model" | places locally |

Hysteresis rules are shapeshift's, unchanged: a committed intent only changes
when a challenger wins two consecutive classifications or scores ≥0.85; it
drops back to `input` when its own probability falls below 0.3. The
thresholds live in one constants object so they can be tuned from tests.

### 3.2 Chip anatomy

`[icon] Timer · 25:00 · "focus"   ↵ place   ⇧↵ ask model   ✕`

- Icon and label come from the kind registry entry.
- The middle segment is a per-intent one-line summary produced by the parser
  (`summary(data)`), so the user can verify what will be placed before Enter.
- ✕ (or Esc) dismisses the chip for this text; the fast lane stays off until
  the text changes substantially (Levenshtein > 30% of length, shapeshift's
  `changedSubstantially`).
- Missing-but-useful fields render as dashed "Add time" / "Add date" chips
  that append the connecting word to the input (shapeshift's "Add …" chips).
  v1 ships this only for `event` (time) and `reminder` (date).

### 3.3 Placement

Committed + Enter:
1. Build the payload via the parser's `toPayload(data)`.
2. Validate against the kind's Zod schema from `src/agent/payloads.ts`. On
   failure, log once, fall through to the model path (never show an error
   for a fast-lane miss).
3. `applyToolDirective(editor, { type: 'place', id, kind, role: 'primary',
   payload }, activeTemplateId)` — identical to `/embed` in
   `slash-commands.ts`.
4. Record `placed` in `preferences-store` for the kind (the same signal the
   agent path records) and append a one-line assistant-free note to the chat
   history: "Placed Timer 25:00 without the model." This keeps the transcript
   honest and gives the user a place to click "Ask the model instead".
5. Clear the input.

The chat message is **not** sent to the backend, so nothing is indexed into
the KB. The widget itself persists through the existing canvas persistence.

### 3.4 Escapes

- Shift+Enter always sends to the model with the text unchanged.
- A leading `/` or `@` disables the fast lane (slash commands and mentions
  own those prefixes).
- Text longer than 140 characters or containing a newline disables it.
  Utility prompts are short; anything else is a conversation.
- Settings → Chat → "Instant widgets for timers, lists and reminders"
  toggle (`user-settings-store`, default on). Off means the composer behaves
  exactly as today.

## 4. Intent set (v1)

| Intent | Example | Kind | Payload mapping |
|---|---|---|---|
| `timer` | "25 min focus", "pomodoro", "1:30 timer" | `time` | `mode: 'timer'`, `durationSec`, `label`; "pomodoro" → `mode: 'pomodoro'`, `pomodoro: { workSec: 1500, breakSec: 300 }` (TimePayload requires both when the object is present) |
| `stopwatch` | "stopwatch", "start a stopwatch for the run" | `time` | `mode: 'stopwatch'`, `label` |
| `clock` | "time in tokyo", "clock pst" | `time` | `mode: 'clock'`, `tz` (IANA from a city/zone table), `label` |
| `todo` | "buy milk, eggs, bread and coffee", "todo: call bank; renew passport" | `tasks` | `title` from a leading verb phrase or "Checklist", `items[].text` split on commas / "and" / semicolons / newlines |
| `reminder` | "remind me to pay rent friday" | `tasks` | one item, `text`, `due` as ISO date from chrono, `title: 'Reminder'` |
| `event` | "standup with priya tomorrow 10am on zoom" | `calendar` | `view: 'month'`, `year/month` of the date, `events: [{date, label}]`, `title` = label; time and attendees fold into `label` ("10:00 Standup with Priya (Zoom)") |
| `note` | "note: the api key rotates monthly", "idea: …" | `sticky-note` | `body`; requires an explicit prefix (`note:`, `idea:`, `todo` excluded) so free text never becomes a note by accident |
| `calc` | "18% of 3450", "2400 / 3", "split 2400 between 3" | `key-value-card` | `title` = the expression, `fields: [{key:'Result', value}]`; split adds `{key:'Each', value}` |
| `convert` | "5 miles in km", "72f to c" | `key-value-card` | `title` = expression, `fields: [{key:'Result', value}]`; a fixed unit table (length, mass, volume, temperature, speed) |

Deliberately excluded from v1: colour, contact, link (already `/embed`),
poll, habit, goal, travel, countdown. Each needs either a new kind or a
weak mapping. Add later, one at a time, behind the same registry.

## 5. Architecture

```
app/src/intent/
  index.ts          classify(text) → IntentResult      (pure)
  keywords.ts       per-intent scorers, one function each (pure)
  decide.ts         state machine + thresholds          (ported, pure)
  registry.ts       INTENTS: { key, kind, icon, label, parse, summary, toPayload }
  parse/
    common.ts       collapse/tidy/number helpers
    timer.ts  stopwatch.ts  clock.ts  todo.ts  reminder.ts
    event.ts  note.ts  calc.ts  convert.ts
  zones.ts          city/zone → IANA table (tokyo, pst, ist, …)

app/src/hooks/useFastLane.ts
  input text → debounced (120 ms, synchronous classify so effectively
  per-keystroke) → decide() memory → { ui, data, summary }

app/src/components/FastLaneChip.tsx
  renders the state from 3.2; sits in the ComposerStatus row next to the
  KB-hits chip

app/src/components/Chat.tsx
  handleSubmit: if fastLane.ui.kind === 'committed' && !shift → place
  onKeyDown: Tab promotes ghost → committed; ←/→ pick in choose; Esc dismiss
```

**Classifier contract** (same shape as shapeshift so `decide.ts` ports as-is):

```ts
type IntentKey = 'timer' | 'stopwatch' | 'clock' | 'todo' | 'reminder'
               | 'event' | 'note' | 'calc' | 'convert' | 'none';
type IntentResult = {
  intent: { value: IntentKey; confidence: number;
            probabilities: Record<IntentKey, number> };
};
```

Scores are additive keyword weights per intent (shapeshift's `mock.ts`
pattern), softmax-normalised to probabilities. `none` gets a floor weight so
short or unclear text stays in `input`. A parser's `complete(data)` result
boosts its own intent (a parsable duration is stronger evidence for `timer`
than the word "timer" alone).

**Dependencies:** `chrono-node` (~90 KB, dates for reminder/event; put it in
its own Vite vendor chunk, loaded on first classify). No other additions.

**Boundaries:**
- `app/src/intent/**` imports nothing from React, tldraw or the stores.
- `useFastLane` owns state; `FastLaneChip` is presentational.
- The only write path into the canvas is `applyToolDirective`.

## 6. Error handling

| Failure | Behaviour |
|---|---|
| Parser throws | Caught in `classify`; that intent scores 0 for this text. Never surfaces. |
| Payload fails Zod | Log once per session per kind; fall through to model path. |
| No editor yet (canvas not mounted) | Fast lane disabled; chip hidden. |
| chrono-node chunk fails to load | Date-dependent intents (`reminder`, `event`) disabled; others unaffected. |
| User has the setting off | Hook returns `input` state; zero cost. |

## 7. Testing

- **Parsers**: table-driven vitest per parser, `__tests__/app/intent/*.test.ts`.
  Each table row: input → expected data, summary, payload. Every example in
  §4 is a row. Dates use a fixed `referenceDate` passed into chrono so tests
  are not time-dependent (the calendar test lesson from this morning).
- **Classifier**: a fixture of ~80 utterances with expected top intent,
  including ~20 that must classify as `none` ("what is the capital of peru",
  "explain this code", "summarise the doc"). Assert precision on `none`
  above recall on anything else: a false positive costs the user a wrong
  widget, a false negative costs nothing.
- **decide.ts**: port shapeshift's tests for hysteresis (challenger needs two
  wins, override at 0.85, drop at 0.3, forced intent survives small edits).
- **Payload validity**: for every intent, `toPayload(parse(example))` passes
  the kind's Zod schema. This is the test that guards against payload drift
  when `payloads.ts` changes.
- **Chat integration** (`Chat.smoke.test.tsx` style): typing "25 min timer"
  shows the committed chip; Enter calls `applyToolDirective` with a `time`
  place directive and does not call `sendMessage`; Shift+Enter calls
  `sendMessage` and not the dispatcher.
- Both suites must stay green; CI already runs them.

## 8. Rollout

1. Land behind the setting, default **on** for local builds, default **off**
   in demo mode for one deploy while the classifier fixture grows from real
   demo prompts (the backend already logs `place_widget` calls; add a
   `fastlane` marker to the anonymous usage counter instead of logging text).
2. Flip demo default to on. Update the launch copy: "timers, lists and
   reminders work instantly, with or without a model key."
3. Follow-ups, each its own small spec: direction 2 (intent → template),
   more intents (countdown, poll), optional provider-backed classifier.

## 9. Decisions (resolved 2026-09-26)

- **Transcript line: yes.** A fast-lane placement appends a one-line local
  note to the chat ("Placed Timer 25:00 without the model") with an "Ask the
  model instead" action. Honesty over tidiness.
- **`event` → `calendar` in v1.** Accept the month grid. Revisit when a
  compact event kind exists.
- **Demo mode: off for the first deploy.** Local builds default on. Flip
  demo after one deploy of fixture growth (§8).
- **`event` → `key-value-card`, not `calendar` (planning change).** `calendar`
  is a plugin kind whose renderer is fetched from `/v1/canvas/widget-kinds`,
  which breaks the zero-network goal. A key-value card (When / With / Mode /
  Where) is compact and renders offline.
- **Bypass key is Cmd/Ctrl+Enter, not Shift+Enter (planning change).**
  Shift+Enter inserts a newline today; a newline already escapes the fast
  lane, so both paths reach the model. The chip says "⌘↵ ask model".

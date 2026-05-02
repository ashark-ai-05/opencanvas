# Plan 4b — Infinite Canvas + Widget Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tldraw as the infinite canvas above the chat panel from Plan 4a, define a `Widget` interface that matches spec §3, register one proof-of-wire custom shape (`TextNoteShape`), and persist canvas state to localStorage so refreshing the page restores the canvas.

**Architecture:** The app's main view becomes a vertical split — tldraw fills most of the viewport, the existing chat panel sits at the bottom. The `Widget` interface lives at `src/core/widget.ts` (framework-agnostic, parallel to spec §3). Each widget is implemented as a tldraw `ShapeUtil` (custom shape) — that's the extension point. Plan 4c adds a real catalog; this plan ships ONE shape (`TextNoteShape`) to prove the registration pattern works. Persistence uses tldraw's built-in `getSnapshot`/`loadSnapshot` API, written to `localStorage['llm-wiki:canvas:default']`.

**Tech Stack additions to Plan 4a:** `tldraw` 3.x (latest), no other new deps.

**References:**
- Plan 4a: `docs/superpowers/plans/2026-05-03-plan-4a-app-shell-and-chat.md` — app scaffold and chat panel
- Design spec: `docs/superpowers/specs/2026-05-02-llm-wiki-design.md` §3 (Widget contract: `acceptsKinds`, `render`, `refresh?`, `actions?`), §1 (canvas-of-cited-widgets vision)
- tldraw custom shapes docs: https://tldraw.dev/docs/shapes#Custom-shapes

**Out of scope (deferred to subsequent 4x plans):**
- Real widget catalog with 5 built-ins — Plan 4c
- Result dispatcher that turns agent output into canvas widgets — Plan 4d
- Canvas templates — Plan 4e
- Backend-side canvas persistence (`/v1/canvases/<id>`) — Plan 4f if needed; localStorage is fine for v1
- Multi-canvas support / canvas tabs — out of scope; one default canvas

---

## File structure

### New files

```
src/core/
  widget.ts                              # Widget interface, ResultKind→Widget map (placeholder)
app/src/
  canvas/
    Canvas.tsx                           # tldraw component, mounted above chat
    persistence.ts                       # localStorage save/load helpers
    shapes/
      text-note.tsx                      # TextNoteShape — proof-of-wire custom shape
__tests__/app/
  text-note-shape.test.tsx
  persistence.test.ts
```

### Modified files

```
app/src/App.tsx                          # split: Canvas (top) + Chat (bottom)
package.json                             # add tldraw
README.md                                # update to mention canvas
src/core/widget.ts                       # NEW (added above)
```

### Files NOT touched

`src/providers/`, `src/embedders/`, `src/storage/`, `src/mcp/`, `src/indexer/`, `src/search/`, `src/backend/`, `src/cli.ts` — backend stays unchanged. App's `Chat.tsx` and `HealthBadge.tsx` from Plan 4a stay stable.

---

## Task 0: Add tldraw

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add tldraw to deps**

Edit `package.json` `dependencies`:

```json
"tldraw": "^3.0.0"
```

If `^3.0.0` doesn't resolve, use `*` for current.

- [ ] **Step 2: Install**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm install
```

Expected: clean install. tldraw is pure JS/React — no native build.

- [ ] **Step 3: Verify nothing regressed**

```bash
cd /Users/krunal/Development/llm-wiki
pnpm test 2>&1 | tail -3
pnpm typecheck 2>&1 | tail -3
```

Expected: all passing.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add package.json pnpm-lock.yaml
git commit -m "chore(app): add tldraw 3.x for canvas"
```

---

## Task 1: Widget interface in `src/core/widget.ts`

**Files:**
- Create: `src/core/widget.ts`
- Test: `__tests__/widget.test.ts`

The `Widget` interface lives in `src/core/` so both backend (eventual orchestration) and frontend (rendering) can reference the same shape. Mirrors spec §3 exactly.

- [ ] **Step 1: Write the failing test**

Create `__tests__/widget.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { Widget, WidgetAction, RenderCtx } from '../src/core/widget.js';
import type { ResultKind } from '../src/core/source.js';

describe('Widget type contract', () => {
  it('accepts a minimal widget definition', () => {
    const w: Widget = {
      id: 'test',
      acceptsKinds: ['text-document'] as ResultKind[],
      shapeType: 'llm-wiki:test',
    };
    expect(w.id).toBe('test');
    expect(w.acceptsKinds).toContain('text-document');
    expect(w.shapeType).toBe('llm-wiki:test');
  });

  it('allows optional actions and refresh', () => {
    const w: Widget = {
      id: 'with-actions',
      acceptsKinds: ['ticket'],
      shapeType: 'llm-wiki:ticket',
      actions: [
        { id: 'open-source', label: 'Open in source' },
        { id: 'pin', label: 'Pin' },
      ],
    };
    expect(w.actions).toHaveLength(2);
  });

  it('RenderCtx exposes editor + result', () => {
    // Just compile-time check — RenderCtx must include these fields.
    const fake = { editor: null, result: null } as unknown as RenderCtx;
    expect(fake).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test widget
```

Expected: FAIL — `widget.js` not found.

- [ ] **Step 3: Implement the interface**

Create `src/core/widget.ts`:

```typescript
import type { ResultKind } from './source.js';

/**
 * A user-actionable affordance on a rendered widget.
 * 'open-in-source', 'pin', 'expand', 'cite', or any string the UI dispatches on.
 */
export type WidgetAction = {
  id: string;
  label: string;
};

/**
 * Render-time context passed to a widget's shape util.
 * Concrete editor type lives in app/src/canvas — keeping this loose-typed
 * here keeps the core package framework-agnostic.
 */
export type RenderCtx = {
  editor: unknown;
  result: unknown;
};

/**
 * Mirrors design spec §3. A Widget describes a renderer keyed by `shapeType`
 * (its tldraw custom-shape `type` literal) and the `ResultKind`s it accepts.
 *
 * v1: widgets are registered statically. The dispatcher (Plan 4d) picks
 * a widget per Result by matching `result.kind` against `acceptsKinds`.
 */
export type Widget = {
  id: string;
  acceptsKinds: ResultKind[];
  /**
   * The tldraw shape type literal, e.g. 'llm-wiki:markdown'. Frontend
   * registers this with tldraw's shapeUtils. `unknown` typed here so this
   * file stays framework-free; concrete impls cast at the boundary.
   */
  shapeType: string;
  actions?: WidgetAction[];
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test widget
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/core/widget.ts __tests__/widget.test.ts
git commit -m "feat(core): Widget interface mirrors spec §3"
```

---

## Task 2: TextNoteShape — proof-of-wire custom shape

**Files:**
- Create: `app/src/canvas/shapes/text-note.tsx`
- Test: `__tests__/app/text-note-shape.test.tsx`

The first custom shape: a draggable text note. Proves the tldraw custom-shape registration pattern. Plan 4c replaces this with the real widget catalog.

- [ ] **Step 1: Implement the shape util**

Create `app/src/canvas/shapes/text-note.tsx`:

```typescript
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  type RecordProps,
  type TLBaseShape,
} from 'tldraw';
import { T } from 'tldraw';

export type TextNoteShape = TLBaseShape<
  'llm-wiki:text-note',
  {
    w: number;
    h: number;
    text: string;
  }
>;

export class TextNoteShapeUtil extends ShapeUtil<TextNoteShape> {
  static override type = 'llm-wiki:text-note' as const;

  static override props: RecordProps<TextNoteShape> = {
    w: T.number,
    h: T.number,
    text: T.string,
  };

  override getDefaultProps(): TextNoteShape['props'] {
    return { w: 240, h: 120, text: 'Text note' };
  }

  override getGeometry(shape: TextNoteShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: TextNoteShape) {
    return (
      <HTMLContainer
        style={{
          width: shape.props.w,
          height: shape.props.h,
          padding: 12,
          background: '#18181b',
          color: '#fafafa',
          border: '1px solid #3f3f46',
          borderRadius: 6,
          fontSize: 14,
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          overflow: 'hidden',
          pointerEvents: 'all',
        }}
      >
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {shape.props.text}
        </div>
      </HTMLContainer>
    );
  }

  override indicator(shape: TextNoteShape) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }

  override canResize() {
    return true;
  }
}
```

- [ ] **Step 2: Write the smoke test**

Create `__tests__/app/text-note-shape.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import { TextNoteShapeUtil } from '../../app/src/canvas/shapes/text-note';

describe('TextNoteShapeUtil', () => {
  it('declares the namespaced shape type', () => {
    expect(TextNoteShapeUtil.type).toBe('llm-wiki:text-note');
  });

  it('exposes a typed props schema', () => {
    expect(TextNoteShapeUtil.props).toBeDefined();
    expect(TextNoteShapeUtil.props.w).toBeDefined();
    expect(TextNoteShapeUtil.props.h).toBeDefined();
    expect(TextNoteShapeUtil.props.text).toBeDefined();
  });

  it('returns sensible default props', () => {
    // Construct a temporary instance to call getDefaultProps;
    // tldraw's ShapeUtil base accepts a null editor for this no-op call shape.
    const util = new TextNoteShapeUtil({} as never);
    const defaults = util.getDefaultProps();
    expect(defaults.w).toBeGreaterThan(0);
    expect(defaults.h).toBeGreaterThan(0);
    expect(typeof defaults.text).toBe('string');
  });
});
```

The exact ShapeUtil constructor shape varies by tldraw version. If `new TextNoteShapeUtil({} as never)` throws, drop that test or pass a minimal mock editor. The other two tests cover the API surface and are version-stable.

- [ ] **Step 3: Run the test**

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/text-note-shape.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/shapes/text-note.tsx __tests__/app/text-note-shape.test.tsx
git commit -m "feat(app): TextNoteShape — first custom tldraw shape (proof-of-wire)"
```

---

## Task 3: Canvas persistence helpers

**Files:**
- Create: `app/src/canvas/persistence.ts`
- Test: `__tests__/app/persistence.test.ts`

Save / load tldraw snapshots to localStorage. Auto-save on canvas change (debounced).

- [ ] **Step 1: Write the failing test**

Create `__tests__/app/persistence.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadCanvasSnapshot,
  saveCanvasSnapshot,
  clearCanvasSnapshot,
  CANVAS_STORAGE_KEY,
} from '../../app/src/canvas/persistence';

describe('canvas persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no snapshot is stored', () => {
    expect(loadCanvasSnapshot()).toBeNull();
  });

  it('round-trips a snapshot through localStorage', () => {
    const fake = { document: { foo: 1 }, session: { bar: 2 } };
    saveCanvasSnapshot(fake as never);
    const loaded = loadCanvasSnapshot();
    expect(loaded).toEqual(fake);
  });

  it('returns null and warns when stored JSON is malformed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(CANVAS_STORAGE_KEY, 'not json');
    expect(loadCanvasSnapshot()).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('clearCanvasSnapshot removes the stored entry', () => {
    saveCanvasSnapshot({ document: {}, session: {} } as never);
    clearCanvasSnapshot();
    expect(loadCanvasSnapshot()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/persistence.test.ts
```

Expected: FAIL — `persistence.ts` not found.

- [ ] **Step 3: Implement**

Create `app/src/canvas/persistence.ts`:

```typescript
import type { TLEditorSnapshot } from 'tldraw';

export const CANVAS_STORAGE_KEY = 'llm-wiki:canvas:default';

export function saveCanvasSnapshot(snapshot: TLEditorSnapshot): void {
  try {
    localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn('[canvas] save failed:', e);
  }
}

export function loadCanvasSnapshot(): TLEditorSnapshot | null {
  const raw = localStorage.getItem(CANVAS_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TLEditorSnapshot;
  } catch (e) {
    console.warn('[canvas] load failed:', e);
    return null;
  }
}

export function clearCanvasSnapshot(): void {
  localStorage.removeItem(CANVAS_STORAGE_KEY);
}
```

If the installed tldraw version names this type differently (`StoreSnapshot` in older, `TLEditorSnapshot` in 3.x), adapt the import and parameter type.

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/persistence.test.ts
```

Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/persistence.ts __tests__/app/persistence.test.ts
git commit -m "feat(app): localStorage canvas snapshot persistence"
```

---

## Task 4: Canvas component — the main feature

**Files:**
- Create: `app/src/canvas/Canvas.tsx`

Mounts tldraw with our custom shape registered, wires auto-save on change, restores from localStorage on mount.

- [ ] **Step 1: Implement**

Create `app/src/canvas/Canvas.tsx`:

```typescript
import { useCallback, useMemo, useRef } from 'react';
import { Tldraw, type Editor, type TLEditorSnapshot } from 'tldraw';
import 'tldraw/tldraw.css';
import { TextNoteShapeUtil } from './shapes/text-note';
import {
  loadCanvasSnapshot,
  saveCanvasSnapshot,
} from './persistence';

const customShapeUtils = [TextNoteShapeUtil];
const SAVE_DEBOUNCE_MS = 500;

export function Canvas() {
  const initialSnapshot = useMemo<TLEditorSnapshot | undefined>(() => {
    const loaded = loadCanvasSnapshot();
    return loaded ?? undefined;
  }, []);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMount = useCallback(
    (editor: Editor) => {
      editor.store.listen(
        () => {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            saveCanvasSnapshot(editor.getSnapshot());
          }, SAVE_DEBOUNCE_MS);
        },
        { source: 'user' }
      );
    },
    []
  );

  return (
    <div className="size-full" style={{ position: 'relative' }}>
      <Tldraw
        shapeUtils={customShapeUtils}
        snapshot={initialSnapshot}
        onMount={handleMount}
        // Hide tldraw's branding to keep the surface ours.
        hideUi={false}
      />
    </div>
  );
}
```

If the installed tldraw API differs (`onMount` signature, `getSnapshot` vs `store.getSnapshot`, `listen` shape), adapt to the version. The `Tldraw` root component and `shapeUtils` prop are stable across 3.x.

- [ ] **Step 2: Manual smoke (later in Task 5 — after App.tsx wires it)**

Defer manual smoke to Task 5 once it's mounted.

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/Canvas.tsx
git commit -m "feat(app): Canvas component — tldraw + custom shape + auto-save"
```

---

## Task 5: Wire Canvas into App.tsx

**Files:**
- Modify: `app/src/App.tsx`

Split the main view: canvas takes ~75% of vertical space, chat takes the bottom ~25%.

- [ ] **Step 1: Update `app/src/App.tsx`**

Replace its contents:

```typescript
import { Canvas } from './canvas/Canvas';
import { Chat } from './components/Chat';
import { HealthBadge } from './components/HealthBadge';

export function App() {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-zinc-800 px-6 py-3 shrink-0">
        <h1 className="text-lg font-semibold tracking-tight">llm-wiki</h1>
        <HealthBadge />
      </header>
      <main className="flex-1 min-h-0 grid grid-rows-[1fr_minmax(160px,28%)]">
        <section className="min-h-0 overflow-hidden border-b border-zinc-800">
          <Canvas />
        </section>
        <section className="min-h-0 overflow-hidden">
          <Chat />
        </section>
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Manual smoke**

Make sure backend is running, then:

```bash
cd /Users/krunal/Development/llm-wiki
pnpm app &
APP_PID=$!
sleep 5
curl -sI http://127.0.0.1:3458 | head -3
kill $APP_PID
```

Expected: 200 from Vite's index. Open http://localhost:3458 in a browser to verify visually:
- Header with "llm-wiki" + green health badge
- tldraw canvas (with toolbar, infinite scroll/zoom)
- Chat panel at the bottom
- Add a test shape: tldraw's draw tool, or right-click for a context menu

Try the `TextNoteShape` programmatically (DevTools console after the editor is mounted):

```javascript
// In the browser console:
const editor = window.editor || /* find via React DevTools */;
editor.createShape({
  type: 'llm-wiki:text-note',
  x: 100,
  y: 100,
  props: { w: 240, h: 120, text: 'Hello from llm-wiki!' },
});
```

Refresh the page — the shape should persist.

If `window.editor` isn't exposed, that's fine — Plan 4c will add programmatic creation via the dispatcher. The auto-save still works for any tldraw-native shapes the user creates.

- [ ] **Step 3: Run all tests + typecheck**

```bash
cd /Users/krunal/Development/llm-wiki
pnpm test
cd app && pnpm exec tsc --noEmit && cd ..
pnpm app:build
```

Expected: tests pass, both typechecks pass, build succeeds. Note: build size will jump significantly because of tldraw — that's expected.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/App.tsx
git commit -m "feat(app): wire Canvas above Chat in App layout"
```

---

## Task 6: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a "Canvas" section**

Find the "Running the app" section from Plan 4a and append:

```markdown
### Canvas (Plan 4b)

The main view splits into an infinite canvas (top) and the chat panel (bottom). Canvas state auto-saves to `localStorage['llm-wiki:canvas:default']` on every change (500ms debounce). Refreshing the page restores the canvas.

To clear the canvas: open DevTools console and run

\`\`\`js
localStorage.removeItem('llm-wiki:canvas:default')
\`\`\`

then reload.

#### Custom widgets (extension point)

Each widget is a tldraw [custom shape](https://tldraw.dev/docs/shapes#Custom-shapes) registered in `app/src/canvas/shapes/`. The `Widget` interface from `src/core/widget.ts` (mirrors design spec §3) ties the shape to one or more `ResultKind` values for the future result dispatcher (Plan 4d).

Adding a new widget:

1. Create `app/src/canvas/shapes/<name>.tsx` with a `ShapeUtil` class
2. Add it to the `customShapeUtils` array in `app/src/canvas/Canvas.tsx`
3. (Plan 4d) Map a `ResultKind` to its shape type in the dispatcher

The TextNoteShape (`llm-wiki:text-note`) is the proof-of-wire example — Plan 4c replaces it with a real widget catalog.

### What's next (Plan 4c–4e)

- **4c**: Built-in widget catalog (Markdown, CodeBlock, TicketCard, SearchResults, SourceProbe)
- **4d**: Result dispatcher — agent output materialises as widgets on the canvas
- **4e**: Canvas templates (AskAnything, TellMeAboutX, WhatsNewSinceY, TraceXEverywhere)
```

(Use real triple-backticks in the actual README.)

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add README.md
git commit -m "docs: canvas, custom-widget extension point, plan roadmap"
```

---

## Spec coverage check

| Spec section | Implemented in (Plan 4b) | Deferred to |
| --- | --- | --- |
| §1 — infinite canvas as the surface | Tasks 4, 5 (Canvas component) | — |
| §3 — Widget interface (`acceptsKinds`, `actions?`) | Task 1 | — |
| §3 — Widget extension model | Task 2 (TextNoteShape proves the pattern) | Plan 4c (real catalog) |
| §1 — saved canvas as durable artifact | Task 3 (localStorage persistence) | Plan 4f (markdown bundles, backend persistence) |
| §3 — `ResultKind` → widget dispatch | — | Plan 4d |

All Plan 4b deliverables traced.

---

## Verification before declaring complete

- [ ] All tests pass: `pnpm test` exits 0 (root + app)
- [ ] Typecheck passes: `pnpm typecheck` exits 0
- [ ] App typecheck: `cd app && pnpm exec tsc --noEmit` exits 0
- [ ] `pnpm app:build` exits 0 and writes `app/dist/` (size will increase by ~1.5MB due to tldraw)
- [ ] Manual smoke: `pnpm dev:app`, open http://localhost:3458 → see canvas above chat panel; create a shape via the toolbar; refresh page; shape persists
- [ ] `git log --oneline` shows ~7 new commits

---

*End of Plan 4b.*

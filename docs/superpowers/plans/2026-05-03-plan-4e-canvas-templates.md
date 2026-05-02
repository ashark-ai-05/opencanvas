# Plan 4e — Canvas Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four canvas templates from spec §3 — `AskAnything`, `TellMeAboutX`, `WhatsNewSinceY`, `TraceXEverywhere` — as selectable layout strategies for the dispatcher. Each template takes `Results[]` and produces `{ shapeType, x, y, props }` placements; the dispatcher uses the active template's layout function. A `TemplatePicker` overlay lets users switch between them at runtime.

**Architecture:** Each template lives at `app/src/canvas/templates/<id>.ts` as a layout function. They share `shapeProps()` (extracted from Plan 4d's dispatcher) so prop mapping is uniform. A `CanvasTemplate` type + registry lives at `app/src/canvas/templates/index.ts`. The active template id sits in the existing Zustand store. The dispatcher reads it and calls the right layout function.

**Tech Stack additions:** None.

**References:**
- Plan 4d: `docs/superpowers/plans/2026-05-03-plan-4d-result-dispatcher.md` — dispatcher + SearchBar + WIDGET_REGISTRY
- Design spec §3 + §7 — template layouts and demo scenarios

**Out of scope:**
- Skill-driven template auto-selection based on query intent (defer to Plan 5 — agent loop)
- "Subject X" / "Date Y" / "Name X" parameter inputs per template — for v1, all templates use the same SearchBar query; specialised inputs come later
- Real graph layout with edges between shapes — TraceXEverywhere v1 is a radial placement, not a connected graph
- Date filtering for WhatsNewSinceY — v1 sorts existing results by `provenance.fetchedAt`; backend date filter is a follow-up

---

## File structure

### New files

```
app/src/canvas/templates/
  types.ts                                   # CanvasTemplate + TemplateLayout types
  shape-props.ts                             # shareable prop-mapping (extracted from dispatcher.ts)
  ask-anything.ts                            # cluster-by-kind grid (current dispatcher behavior)
  tell-me-about-x.ts                         # 5-zone grid: Header/Code/Docs/Activity/Related
  whats-new-since-y.ts                       # timeline lanes by source, sorted by fetchedAt
  trace-x-everywhere.ts                      # radial: subject at center, results at angles
  index.ts                                   # registry + default
app/src/state/
  template-store.ts                          # Zustand: active template id
app/src/components/
  TemplatePicker.tsx                         # dropdown overlay near SearchBar
__tests__/app/
  templates.test.ts                          # all 4 templates produce sensible placements
  template-store.test.ts
```

### Modified files

```
app/src/canvas/dispatcher.ts                 # use active template's layout function
app/src/canvas/Canvas.tsx                    # mount TemplatePicker
README.md                                    # template catalog
```

### Files NOT touched

`src/core/`, `src/backend/`, `src/search/`, all shape utils, `src/core/widget-registry.ts` — Plan 4d's contract is stable. We're adding a layout layer on top.

---

## Task 0: Types + shareable prop mapping

**Files:**
- Create: `app/src/canvas/templates/types.ts`
- Create: `app/src/canvas/templates/shape-props.ts`

Extract the prop-mapping logic from Plan 4d's `dispatcher.ts` into a shared helper so all four templates use the same mapping (only positions differ).

- [ ] **Step 1: Implement types**

Create `app/src/canvas/templates/types.ts`:

```typescript
import type { Box } from 'tldraw';
import type { SearchResult } from '../../api/search';

/**
 * Placement produced by a template's layout function. Coordinates are in
 * page-space (same coord system as `editor.getViewportPageBounds()`).
 */
export type ShapePlacement = {
  shapeType: string;
  x: number;
  y: number;
  props: Record<string, unknown>;
};

/**
 * A layout function maps a list of Results onto canvas positions.
 * Receives the current viewport so it can position relative to wherever
 * the user is looking, not (0, 0) in page space.
 */
export type TemplateLayout = (
  results: SearchResult[],
  viewport: Box
) => ShapePlacement[];

export type CanvasTemplate = {
  id: 'ask-anything' | 'tell-me-about-x' | 'whats-new-since-y' | 'trace-x-everywhere';
  name: string;
  layout: TemplateLayout;
};
```

- [ ] **Step 2: Implement shape-props helper (extracted from dispatcher.ts)**

Create `app/src/canvas/templates/shape-props.ts`:

```typescript
import type { SearchResult } from '../../api/search';

/**
 * Map a Result + chosen shapeType to the props expected by that
 * shape's ShapeUtil. Mirrors the logic Plan 4d originally inlined into
 * dispatcher.ts; extracted here so all templates share it.
 */
export function shapeProps(
  shapeType: string,
  result: SearchResult,
  size: { w: number; h: number }
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...result.shape, uri: result.provenance.uri };

  switch (shapeType) {
    case 'llm-wiki:markdown':
      return { w: size.w, h: size.h, ...base };
    case 'llm-wiki:code-block':
      return { w: size.w, h: size.h, ...base };
    case 'llm-wiki:ticket':
      return {
        w: size.w,
        h: size.h,
        ticketId: result.id,
        title: (result.shape as { title?: string }).title ?? 'Untitled',
        ...base,
      };
    case 'llm-wiki:web-embed':
      return { w: size.w, h: size.h, url: (result.shape as { url?: string }).url ?? '', ...base };
    case 'llm-wiki:key-value-card':
    default:
      return {
        w: size.w,
        h: size.h,
        title: (result.shape as { title?: string }).title ?? result.kind,
        pairs: (result.shape as { pairs?: Array<{ key: string; value: string }> }).pairs ?? [],
        ...base,
      };
  }
}

export const DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  'llm-wiki:markdown':       { w: 360, h: 240 },
  'llm-wiki:code-block':     { w: 480, h: 280 },
  'llm-wiki:ticket':         { w: 320, h: 200 },
  'llm-wiki:web-embed':      { w: 480, h: 320 },
  'llm-wiki:key-value-card': { w: 320, h: 200 },
};
```

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/templates/types.ts app/src/canvas/templates/shape-props.ts
git commit -m "feat(app): canvas template types + shareable prop mapping"
```

---

## Task 1: AskAnything template (cluster by kind)

**Files:**
- Create: `app/src/canvas/templates/ask-anything.ts`

Mirrors the current Plan 4d dispatcher behavior — group by kind, place each group as a column.

- [ ] **Step 1: Implement**

Create `app/src/canvas/templates/ask-anything.ts`:

```typescript
import { pickWidgetForKind } from '../../../../src/core/widget-registry';
import { DEFAULT_SIZES, shapeProps } from './shape-props';
import type { CanvasTemplate, ShapePlacement, TemplateLayout } from './types';

const COL_GAP = 60;
const ROW_GAP = 20;

const askAnythingLayout: TemplateLayout = (results, viewport) => {
  const placements: ShapePlacement[] = [];
  if (results.length === 0) return placements;

  const originX = viewport.x + 80;
  const originY = viewport.y + 100;

  // Group by kind, preserving result order within each group.
  const byKind = new Map<string, typeof results>();
  for (const r of results) {
    const arr = byKind.get(r.kind) ?? [];
    arr.push(r);
    byKind.set(r.kind, arr);
  }

  let col = 0;
  for (const [, group] of byKind) {
    const widget = pickWidgetForKind(group[0].kind);
    const size = DEFAULT_SIZES[widget.shapeType] ?? { w: 320, h: 200 };
    let row = 0;
    for (const r of group) {
      placements.push({
        shapeType: widget.shapeType,
        x: originX + col * (size.w + COL_GAP),
        y: originY + row * (size.h + ROW_GAP),
        props: shapeProps(widget.shapeType, r, size),
      });
      row++;
    }
    col++;
  }

  return placements;
};

export const ASK_ANYTHING_TEMPLATE: CanvasTemplate = {
  id: 'ask-anything',
  name: 'Ask anything',
  layout: askAnythingLayout,
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/templates/ask-anything.ts
git commit -m "feat(app): AskAnything template (cluster-by-kind grid)"
```

---

## Task 2: TellMeAboutX template (5-zone grid)

**Files:**
- Create: `app/src/canvas/templates/tell-me-about-x.ts`

Five named zones per spec §3 (Header, Code, Docs, Activity, Related). Each zone holds a different cluster of result kinds.

- [ ] **Step 1: Implement**

Create `app/src/canvas/templates/tell-me-about-x.ts`:

```typescript
import { pickWidgetForKind } from '../../../../src/core/widget-registry';
import type { ResultKind } from '../../../../src/core/source';
import type { SearchResult } from '../../api/search';
import { DEFAULT_SIZES, shapeProps } from './shape-props';
import type { CanvasTemplate, ShapePlacement, TemplateLayout } from './types';

type ZoneId = 'header' | 'code' | 'docs' | 'activity' | 'related';

const KIND_TO_ZONE: Record<string, ZoneId> = {
  'text-document':  'docs',
  'wiki-page':      'docs',
  'code-symbol':    'code',
  'code-file':      'code',
  'code-diff':      'activity',
  'ticket':         'activity',
  'log-stream':     'activity',
  'k8s-resource':   'activity',
  'web-page':       'related',
  'image':          'related',
  'metric-series':  'activity',
  'chat-message':   'activity',
  'runbook':        'docs',
  'dashboard-embed':'related',
  'table-row-set':  'related',
};

const ZONES: Record<ZoneId, { x: number; y: number; w: number; h: number; label: string }> = {
  // Layout (relative to viewport top-left + padding):
  //
  //   ┌─ Header (full width, single row) ──────────────────┐
  //   │ The "subject" card / search query banner.          │
  //   ├──────────────┬──────────────────┬──────────────────┤
  //   │   Code       │     Docs         │     Activity     │
  //   │   (left)     │    (centre)      │     (right)      │
  //   ├──────────────┴──────────────────┴──────────────────┤
  //   │             Related (bottom band, full width)      │
  //   └────────────────────────────────────────────────────┘
  header:   { x: 0,    y: 0,   w: 1500, h: 120,  label: 'Header'   },
  code:     { x: 0,    y: 140, w: 480,  h: 700,  label: 'Code'     },
  docs:     { x: 500,  y: 140, w: 480,  h: 700,  label: 'Docs'     },
  activity: { x: 1000, y: 140, w: 480,  h: 700,  label: 'Activity' },
  related:  { x: 0,    y: 860, w: 1500, h: 320,  label: 'Related'  },
};

const tellMeAboutXLayout: TemplateLayout = (results, viewport) => {
  const placements: ShapePlacement[] = [];
  const originX = viewport.x + 80;
  const originY = viewport.y + 80;

  // Group results by zone.
  const byZone = new Map<ZoneId, SearchResult[]>();
  for (const r of results) {
    const zone = KIND_TO_ZONE[r.kind] ?? 'related';
    const arr = byZone.get(zone) ?? [];
    arr.push(r);
    byZone.set(zone, arr);
  }

  // Header is empty in v1 (no "subject" parameter yet — skip).

  for (const [zoneId, zoneResults] of byZone) {
    const zone = ZONES[zoneId];
    let row = 0;
    for (const r of zoneResults) {
      const widget = pickWidgetForKind(r.kind as ResultKind);
      const size = DEFAULT_SIZES[widget.shapeType] ?? { w: 320, h: 200 };
      // Stack results vertically within the zone, capping at zone bounds.
      const cappedSize = {
        w: Math.min(size.w, zone.w - 16),
        h: Math.min(size.h, zone.h),
      };
      placements.push({
        shapeType: widget.shapeType,
        x: originX + zone.x + 8,
        y: originY + zone.y + row * (cappedSize.h + 16),
        props: shapeProps(widget.shapeType, r, cappedSize),
      });
      row++;
    }
  }

  return placements;
};

export const TELL_ME_ABOUT_X_TEMPLATE: CanvasTemplate = {
  id: 'tell-me-about-x',
  name: 'Tell me about X',
  layout: tellMeAboutXLayout,
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/templates/tell-me-about-x.ts
git commit -m "feat(app): TellMeAboutX template (5-zone grid layout)"
```

---

## Task 3: WhatsNewSinceY template (timeline lanes)

**Files:**
- Create: `app/src/canvas/templates/whats-new-since-y.ts`

Lanes per source. Time axis from oldest (left) to newest (right), positioned by `provenance.fetchedAt`.

- [ ] **Step 1: Implement**

Create `app/src/canvas/templates/whats-new-since-y.ts`:

```typescript
import { pickWidgetForKind } from '../../../../src/core/widget-registry';
import type { ResultKind } from '../../../../src/core/source';
import { DEFAULT_SIZES, shapeProps } from './shape-props';
import type { CanvasTemplate, ShapePlacement, TemplateLayout } from './types';

const LANE_HEIGHT = 220;
const LANE_GAP = 40;
const TIMELINE_WIDTH = 1400;

const whatsNewSinceYLayout: TemplateLayout = (results, viewport) => {
  const placements: ShapePlacement[] = [];
  if (results.length === 0) return placements;

  const originX = viewport.x + 80;
  const originY = viewport.y + 80;

  // Group by sourceId — each source becomes a lane.
  const bySource = new Map<string, typeof results>();
  for (const r of results) {
    const arr = bySource.get(r.sourceId) ?? [];
    arr.push(r);
    bySource.set(r.sourceId, arr);
  }

  // Time scale: map [minFetchedAt, maxFetchedAt] → [0, TIMELINE_WIDTH].
  const allTimestamps = results.map((r) => r.provenance.fetchedAt);
  const minT = Math.min(...allTimestamps);
  const maxT = Math.max(...allTimestamps);
  const tRange = Math.max(1, maxT - minT);

  let lane = 0;
  for (const [, group] of bySource) {
    for (const r of group) {
      const widget = pickWidgetForKind(r.kind as ResultKind);
      const size = DEFAULT_SIZES[widget.shapeType] ?? { w: 320, h: 200 };
      const cappedSize = { w: Math.min(size.w, 280), h: Math.min(size.h, LANE_HEIGHT - 20) };
      const tNorm = (r.provenance.fetchedAt - minT) / tRange;
      placements.push({
        shapeType: widget.shapeType,
        x: originX + tNorm * (TIMELINE_WIDTH - cappedSize.w),
        y: originY + lane * (LANE_HEIGHT + LANE_GAP),
        props: shapeProps(widget.shapeType, r, cappedSize),
      });
    }
    lane++;
  }

  return placements;
};

export const WHATS_NEW_SINCE_Y_TEMPLATE: CanvasTemplate = {
  id: 'whats-new-since-y',
  name: "What's new since Y",
  layout: whatsNewSinceYLayout,
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/templates/whats-new-since-y.ts
git commit -m "feat(app): WhatsNewSinceY template (timeline lanes by source)"
```

---

## Task 4: TraceXEverywhere template (radial graph)

**Files:**
- Create: `app/src/canvas/templates/trace-x-everywhere.ts`

Radial: an empty "subject" placeholder at center (Plan 4f or 5 fills it from query); results placed at angles around it. v1 has no edges between shapes — that's a future Plan with tldraw's `bind` API.

- [ ] **Step 1: Implement**

Create `app/src/canvas/templates/trace-x-everywhere.ts`:

```typescript
import { pickWidgetForKind } from '../../../../src/core/widget-registry';
import type { ResultKind } from '../../../../src/core/source';
import { DEFAULT_SIZES, shapeProps } from './shape-props';
import type { CanvasTemplate, ShapePlacement, TemplateLayout } from './types';

const RADIUS = 360;

const traceXEverywhereLayout: TemplateLayout = (results, viewport) => {
  const placements: ShapePlacement[] = [];
  if (results.length === 0) return placements;

  const centreX = viewport.x + viewport.w / 2;
  const centreY = viewport.y + viewport.h / 2;

  // Place the centre placeholder card. v1 uses a key-value-card with the
  // generic title "Subject"; Plan 4f or the agent loop replaces this when
  // the user supplies an explicit subject.
  placements.push({
    shapeType: 'llm-wiki:key-value-card',
    x: centreX - 160,
    y: centreY - 100,
    props: {
      w: 320,
      h: 200,
      title: 'Subject',
      pairs: [{ key: 'results', value: String(results.length) }],
    },
  });

  // Distribute results around a circle.
  const n = results.length;
  for (let i = 0; i < n; i++) {
    const r = results[i];
    const widget = pickWidgetForKind(r.kind as ResultKind);
    const size = DEFAULT_SIZES[widget.shapeType] ?? { w: 320, h: 200 };

    const angle = (i / n) * 2 * Math.PI - Math.PI / 2; // start at 12 o'clock
    const cx = centreX + Math.cos(angle) * RADIUS;
    const cy = centreY + Math.sin(angle) * RADIUS;

    placements.push({
      shapeType: widget.shapeType,
      x: cx - size.w / 2,
      y: cy - size.h / 2,
      props: shapeProps(widget.shapeType, r, size),
    });
  }

  return placements;
};

export const TRACE_X_EVERYWHERE_TEMPLATE: CanvasTemplate = {
  id: 'trace-x-everywhere',
  name: 'Trace X everywhere',
  layout: traceXEverywhereLayout,
};
```

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/templates/trace-x-everywhere.ts
git commit -m "feat(app): TraceXEverywhere template (radial graph layout)"
```

---

## Task 5: Template registry + Zustand store

**Files:**
- Create: `app/src/canvas/templates/index.ts`
- Create: `app/src/state/template-store.ts`
- Test: `__tests__/app/templates.test.ts`
- Test: `__tests__/app/template-store.test.ts`

- [ ] **Step 1: Implement registry**

Create `app/src/canvas/templates/index.ts`:

```typescript
import { ASK_ANYTHING_TEMPLATE } from './ask-anything';
import { TELL_ME_ABOUT_X_TEMPLATE } from './tell-me-about-x';
import { WHATS_NEW_SINCE_Y_TEMPLATE } from './whats-new-since-y';
import { TRACE_X_EVERYWHERE_TEMPLATE } from './trace-x-everywhere';
import type { CanvasTemplate } from './types';

export const TEMPLATES: CanvasTemplate[] = [
  ASK_ANYTHING_TEMPLATE,
  TELL_ME_ABOUT_X_TEMPLATE,
  WHATS_NEW_SINCE_Y_TEMPLATE,
  TRACE_X_EVERYWHERE_TEMPLATE,
];

export const TEMPLATES_BY_ID: Record<CanvasTemplate['id'], CanvasTemplate> = {
  'ask-anything':       ASK_ANYTHING_TEMPLATE,
  'tell-me-about-x':    TELL_ME_ABOUT_X_TEMPLATE,
  'whats-new-since-y':  WHATS_NEW_SINCE_Y_TEMPLATE,
  'trace-x-everywhere': TRACE_X_EVERYWHERE_TEMPLATE,
};

export const DEFAULT_TEMPLATE_ID: CanvasTemplate['id'] = 'ask-anything';

export type { CanvasTemplate };
export type { ShapePlacement, TemplateLayout } from './types';
```

- [ ] **Step 2: Implement store**

Create `app/src/state/template-store.ts`:

```typescript
import { create } from 'zustand';
import type { CanvasTemplate } from '../canvas/templates';
import { DEFAULT_TEMPLATE_ID } from '../canvas/templates';

type TemplateStore = {
  activeTemplateId: CanvasTemplate['id'];
  setActiveTemplateId: (id: CanvasTemplate['id']) => void;
};

export const useTemplateStore = create<TemplateStore>((set) => ({
  activeTemplateId: DEFAULT_TEMPLATE_ID,
  setActiveTemplateId: (id) => set({ activeTemplateId: id }),
}));
```

- [ ] **Step 3: Write template tests**

Create `__tests__/app/templates.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { TEMPLATES, TEMPLATES_BY_ID } from '../../app/src/canvas/templates';
import type { SearchResult } from '../../app/src/api/search';
import type { Box } from 'tldraw';

const VIEWPORT = { x: 0, y: 0, w: 1500, h: 1000 } as Box;

function fakeResults(): SearchResult[] {
  return [
    {
      id: '1', sourceId: 'src-a', kind: 'text-document',
      shape: { title: 'Doc 1', body: 'body' },
      provenance: { uri: 'mem://doc1', fetchedAt: 1000 },
      freshness: {}, links: [],
    },
    {
      id: '2', sourceId: 'src-b', kind: 'code-symbol',
      shape: { symbolName: 'foo', filePath: 'a.ts', body: 'fn' },
      provenance: { uri: 'file://a.ts#foo', fetchedAt: 2000 },
      freshness: {}, links: [],
    },
    {
      id: '3', sourceId: 'src-a', kind: 'ticket',
      shape: { title: 'Bug 42', description: 'broken' },
      provenance: { uri: 'jira://42', fetchedAt: 3000 },
      freshness: {}, links: [],
    },
  ];
}

describe('canvas templates', () => {
  it('exposes all 4 expected templates by id', () => {
    expect(TEMPLATES).toHaveLength(4);
    expect(TEMPLATES_BY_ID['ask-anything']).toBeDefined();
    expect(TEMPLATES_BY_ID['tell-me-about-x']).toBeDefined();
    expect(TEMPLATES_BY_ID['whats-new-since-y']).toBeDefined();
    expect(TEMPLATES_BY_ID['trace-x-everywhere']).toBeDefined();
  });

  it('AskAnything: produces one placement per result', () => {
    const placements = TEMPLATES_BY_ID['ask-anything'].layout(fakeResults(), VIEWPORT);
    expect(placements).toHaveLength(3);
  });

  it('TellMeAboutX: places code-symbol in the code zone (left column)', () => {
    const placements = TEMPLATES_BY_ID['tell-me-about-x'].layout(fakeResults(), VIEWPORT);
    const codePlacement = placements.find((p) => p.shapeType === 'llm-wiki:code-block');
    expect(codePlacement).toBeDefined();
    // Code zone is at x=0 relative; with padding originX=80, expect roughly there
    expect(codePlacement!.x).toBeLessThan(200);
  });

  it('WhatsNewSinceY: x increases with fetchedAt (within the same lane the older is left)', () => {
    const placements = TEMPLATES_BY_ID['whats-new-since-y'].layout(fakeResults(), VIEWPORT);
    // Find Doc 1 (oldest, fetchedAt=1000) and Bug 42 (newest in src-a, fetchedAt=3000)
    const doc1 = placements.find((p) => (p.props as { title?: string }).title === 'Doc 1');
    const bug42 = placements.find((p) => (p.props as { title?: string }).title === 'Bug 42');
    expect(doc1).toBeDefined();
    expect(bug42).toBeDefined();
    // Both are in src-a so same lane; older one should be to the left.
    expect(doc1!.x).toBeLessThan(bug42!.x);
  });

  it('TraceXEverywhere: includes a centre subject + one placement per result', () => {
    const placements = TEMPLATES_BY_ID['trace-x-everywhere'].layout(fakeResults(), VIEWPORT);
    // n results + 1 centre placeholder
    expect(placements).toHaveLength(4);
    // The centre placeholder is a key-value-card
    const subjects = placements.filter(
      (p) => p.shapeType === 'llm-wiki:key-value-card' && (p.props as { title?: string }).title === 'Subject'
    );
    expect(subjects).toHaveLength(1);
  });

  it('every template handles an empty result list without throwing', () => {
    for (const t of TEMPLATES) {
      expect(t.layout([], VIEWPORT)).toEqual([]);
    }
  });
});
```

Note: the `whats-new-since-y` empty-list test will pass because we return `[]` early. The trace template ALSO needs to return `[]` for an empty list — verify the implementation does that. (It does, via the early-return guard.)

- [ ] **Step 4: Write store test**

Create `__tests__/app/template-store.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { useTemplateStore } from '../../app/src/state/template-store';

describe('useTemplateStore', () => {
  it('starts at the default template id', () => {
    const { activeTemplateId } = useTemplateStore.getState();
    expect(activeTemplateId).toBe('ask-anything');
  });

  it('setActiveTemplateId switches templates', () => {
    useTemplateStore.getState().setActiveTemplateId('tell-me-about-x');
    expect(useTemplateStore.getState().activeTemplateId).toBe('tell-me-about-x');

    // Reset for downstream tests
    useTemplateStore.getState().setActiveTemplateId('ask-anything');
  });
});
```

- [ ] **Step 5: Run tests**

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/templates.test.ts ../__tests__/app/template-store.test.ts
```

Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/templates/index.ts app/src/state/template-store.ts \
        __tests__/app/templates.test.ts __tests__/app/template-store.test.ts
git commit -m "feat(app): template registry + Zustand active-template store"
```

---

## Task 6: TemplatePicker UI + dispatcher integration

**Files:**
- Create: `app/src/components/TemplatePicker.tsx`
- Modify: `app/src/canvas/dispatcher.ts`
- Modify: `app/src/canvas/Canvas.tsx`

- [ ] **Step 1: Refactor dispatcher.ts to use the active template**

Read `app/src/canvas/dispatcher.ts`. Replace its contents:

```typescript
import type { Editor } from 'tldraw';
import type { SearchResult } from '../api/search';
import { TEMPLATES_BY_ID } from './templates';
import { useTemplateStore } from '../state/template-store';

/**
 * Place results on the canvas using the active template's layout.
 * The layout function returns ShapePlacement[]; we hand each one to
 * editor.createShape.
 */
export function placeResultsOnCanvas(
  editor: Editor,
  results: SearchResult[]
): void {
  if (results.length === 0) return;

  const { activeTemplateId } = useTemplateStore.getState();
  const template = TEMPLATES_BY_ID[activeTemplateId];
  const placements = template.layout(results, editor.getViewportPageBounds());

  for (const p of placements) {
    editor.createShape({
      type: p.shapeType,
      x: p.x,
      y: p.y,
      props: p.props,
    });
  }
}
```

This thin dispatcher delegates entirely to the active template. The Plan 4d test that was checking shapeType→Result mapping still passes because the same logic now lives in `ask-anything.ts` (the default template).

- [ ] **Step 2: Implement the TemplatePicker**

Create `app/src/components/TemplatePicker.tsx`:

```typescript
import { TEMPLATES } from '../canvas/templates';
import { useTemplateStore } from '../state/template-store';

export function TemplatePicker() {
  const activeId = useTemplateStore((s) => s.activeTemplateId);
  const setActive = useTemplateStore((s) => s.setActiveTemplateId);

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 320, // sit to the left of SearchBar (which is at right: 12 with min-width 280 + padding)
        zIndex: 200,
        display: 'flex',
        gap: 6,
        padding: 6,
        background: 'rgba(24, 24, 27, 0.95)',
        border: '1px solid #3f3f46',
        borderRadius: 8,
        backdropFilter: 'blur(8px)',
      }}
    >
      <span style={{ fontSize: 11, color: '#71717a', alignSelf: 'center', padding: '0 6px' }}>
        layout
      </span>
      <select
        value={activeId}
        onChange={(e) => setActive(e.target.value as typeof activeId)}
        aria-label="Canvas layout"
        style={{
          padding: '4px 10px',
          fontSize: 12,
          background: '#27272a',
          color: '#fafafa',
          border: '1px solid #3f3f46',
          borderRadius: 4,
          cursor: 'pointer',
          outline: 'none',
        }}
      >
        {TEMPLATES.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 3: Mount in Canvas**

Read `app/src/canvas/Canvas.tsx`. Add the import:

```typescript
import { TemplatePicker } from '../components/TemplatePicker';
```

And inside `<Tldraw>` children:

```typescript
<Tldraw ...>
  <DebugToolbar />
  <SearchBar />
  <TemplatePicker />
</Tldraw>
```

- [ ] **Step 4: Update Plan 4d's dispatcher test**

The Plan 4d test (`__tests__/app/dispatcher.test.ts`) still uses the old logic-inlined dispatcher. With the refactor, the dispatcher delegates to the active template (default = ask-anything). The asserted shape-type mappings still hold because ask-anything maps via WIDGET_REGISTRY identically.

Run to verify:

```bash
cd /Users/krunal/Development/llm-wiki/app && pnpm exec vitest run --root .. ../__tests__/app/dispatcher.test.ts
```

Expected: PASS, all 4 tests still green. If the test breaks because the editor mock no longer captures `props.title` directly (since the call goes through the template's layout function and shape-props.ts), inspect the failures and adjust the mock. The test calls `placeResultsOnCanvas` — the resulting `editor.createShape.mock.calls[0][0]` should still have `type` and `props` matching what the ask-anything template produces.

- [ ] **Step 5: Build + run all tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm app:build && pnpm test
```

Expected: build exits 0, all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add app/src/canvas/dispatcher.ts app/src/components/TemplatePicker.tsx app/src/canvas/Canvas.tsx
git commit -m "feat(app): dispatcher uses active template + TemplatePicker overlay"
```

---

## Task 7: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append**

Add to the canvas section:

```markdown
### Canvas templates (Plan 4e)

Four layouts you can switch between via the "layout" dropdown (top-right of the canvas, beside the SearchBar):

| Template | Layout | Best for |
| --- | --- | --- |
| **Ask anything** (default) | Cluster-by-kind grid — one column per Result.kind | Open-ended questions, "what's around" |
| **Tell me about X** | 5-zone grid: Header / Code (left) / Docs (centre) / Activity (right) / Related (bottom) | Subject deep-dives — see code, docs, and activity around one thing at a glance |
| **What's new since Y** | Lanes per source, x-axis = `fetchedAt` time, oldest left → newest right | Catch-up after time off, recent activity |
| **Trace X everywhere** | Radial — subject card centred, results placed at angles around it | Cross-source references to a name/symbol |

Pick a layout, run a search — results materialize using that layout. Switching templates only affects new placements; existing shapes stay where they are.

#### Adding a template

Each template is a layout function at `app/src/canvas/templates/<id>.ts`:

\`\`\`typescript
export const layout: TemplateLayout = (results, viewport) => {
  return results.map((r, i) => ({
    shapeType: '...',
    x: ..., y: ...,
    props: shapeProps('...', r, { w: 320, h: 200 }),
  }));
};
\`\`\`

Register in `app/src/canvas/templates/index.ts`. The TemplatePicker picks it up automatically.

### What's next

Plan 4e closes out the v1 visual surface. Future plans:

- **Plan 5**: Agent loop — chat output triggers searches and dispatches widgets to the active template autonomously
- **Plan 3e**: Cross-source link resolver — turns `JIRA-123`, file paths, k8s names in widget bodies into clickable shape-to-shape links on the canvas
- **Plan 3b**: PDF + HTML in document indexer
- **Plan 3c.1+**: Python / Go / Java / Ruby code adapters
```

(Use real triple-backticks in the actual README.)

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add README.md
git commit -m "docs: canvas templates catalog + how to add a template"
```

---

## Spec coverage check

| Spec section | Implemented in (Plan 4e) | Deferred to |
| --- | --- | --- |
| §3 — `AskAnything` template (free) | Task 1 | — |
| §3 — `TellMeAboutX` template (grid w/ zones) | Task 2 | Plan 4f (subject parameter input) |
| §3 — `WhatsNewSinceY` template (timeline) | Task 3 | Plan 4f (date parameter input + backend filter) |
| §3 — `TraceXEverywhere` template (graph) | Task 4 (radial v1) | Plan 5 (real edges via `bind`) |
| §3 — Skill-driven template selection | — | Plan 5 (agent loop) |

All Plan 4e deliverables traced.

---

## Verification before declaring complete

- [ ] All tests pass: `pnpm test` exits 0 (root + app)
- [ ] Both typechecks exit 0
- [ ] `pnpm app:build` exits 0
- [ ] Manual smoke: `pnpm dev:app`, search for an indexed term, switch the layout dropdown to each template, observe distinct placements
- [ ] `git log --oneline` shows ~9 new commits

---

*End of Plan 4e. End of Plan 4 series.*

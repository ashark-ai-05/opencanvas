import { pickWidgetForKind } from '../../../../src/core/widget-registry';
import type { ResultKind } from '../../../../src/core/source';
import type { Role } from '../../../../src/agent/types';
import type { SearchResult } from '../../api/search';
import { DEFAULT_SIZES, shapeProps } from './shape-props';
import type { CanvasTemplate, ShapePlacement, TemplateLayout } from './types';

const TELL_ZONES: Record<Role, { col: number; row: number }> = {
  primary: { col: 1, row: 0 },
  detail: { col: 1, row: 1 },
  related: { col: 0, row: 1 },
  reference: { col: 2, row: 1 },
  timeline: { col: 2, row: 0 },
  node: { col: 0, row: 0 },
};

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
  slotForRole: (role, occupancy, viewport) => {
    const w = 360;
    const h = 220;
    const z = TELL_ZONES[role];
    return {
      x: viewport.x + 60 + z.col * (w + 40),
      y: viewport.y + 80 + z.row * (h + 40) + occupancy * (h + 20),
      w,
      h,
    };
  },
};

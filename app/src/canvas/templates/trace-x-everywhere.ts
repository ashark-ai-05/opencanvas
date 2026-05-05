import { pickWidgetForKind } from '../../../../src/core/widget-registry';
import type { ResultKind } from '../../../../src/core/source';
import type { Role } from '../../../../src/agent/types';
import { DEFAULT_SIZES, shapeProps } from './shape-props';
import type { CanvasTemplate, ShapePlacement, TemplateLayout } from './types';

const TRACE_ANGLES: Record<Role, number> = {
  primary: 0,
  detail: 0,
  related: 60,
  reference: 120,
  timeline: 180,
  node: 240,
};

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
    shapeType: 'opencanvas:key-value-card',
    x: centreX - 160,
    y: centreY - 100,
    props: {
      w: 320,
      h: 200,
      title: 'Subject',
      fields: [{ key: 'results', value: String(results.length) }],
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
  slotForRole: (role, occupancy, viewport) => {
    const w = 260;
    const h = 160;
    const cx = viewport.x + viewport.w / 2 - w / 2;
    const cy = viewport.y + viewport.h / 2 - h / 2;
    if (role === 'primary') return { x: cx, y: cy, w, h };
    const radius = 280 + occupancy * 60;
    const deg = TRACE_ANGLES[role] + occupancy * 12;
    const rad = (deg * Math.PI) / 180;
    return {
      x: cx + Math.cos(rad) * radius,
      y: cy + Math.sin(rad) * radius,
      w,
      h,
    };
  },
};

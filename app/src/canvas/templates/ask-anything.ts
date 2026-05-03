import { pickWidgetForKind } from '../../../../src/core/widget-registry';
import type { Role } from '../../../../src/agent/types';
import { DEFAULT_SIZES, shapeProps } from './shape-props';
import type { CanvasTemplate, ShapePlacement, TemplateLayout } from './types';

const ASK_ROLE_COLS: Record<Role, number> = {
  primary: 0,
  detail: 1,
  related: 2,
  reference: 3,
  timeline: 4,
  node: 5,
};

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
  slotForRole: (role, occupancy, viewport) => {
    const w = 320;
    const h = 200;
    const col = ASK_ROLE_COLS[role];
    return {
      x: viewport.x + 80 + col * (w + 60),
      y: viewport.y + 100 + occupancy * (h + 20),
      w,
      h,
    };
  },
};

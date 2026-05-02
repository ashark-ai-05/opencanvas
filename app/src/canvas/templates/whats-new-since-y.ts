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

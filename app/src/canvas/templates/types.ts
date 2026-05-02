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

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
   * The tldraw shape type literal, e.g. 'opencanvas:markdown'. Frontend
   * registers this with tldraw's shapeUtils. `unknown` typed here so this
   * file stays framework-free; concrete impls cast at the boundary.
   */
  shapeType: string;
  actions?: WidgetAction[];
};

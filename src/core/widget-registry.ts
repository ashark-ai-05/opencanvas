import type { ResultKind } from './source.js';
import type { Widget } from './widget.js';

const MARKDOWN: Widget = {
  id: 'markdown',
  acceptsKinds: ['text-document', 'wiki-page'],
  shapeType: 'strata:markdown',
};
const CODE_BLOCK: Widget = {
  id: 'code-block',
  acceptsKinds: ['code-symbol', 'code-file'],
  shapeType: 'strata:code-block',
};
const TICKET: Widget = {
  id: 'ticket',
  acceptsKinds: ['ticket'],
  shapeType: 'strata:ticket',
};
const WEB_EMBED: Widget = {
  id: 'web-embed',
  acceptsKinds: ['web-page'],
  shapeType: 'strata:web-embed',
};
const KEY_VALUE_CARD: Widget = {
  id: 'key-value-card',
  // Fallback — accepts every kind that doesn't have a specific widget.
  // The dispatcher (Plan 4d) treats this as the "no match" branch.
  acceptsKinds: [
    'image',
    'metric-series',
    'chat-message',
    'runbook',
    'dashboard-embed',
    'k8s-resource',
    'code-diff',
  ],
  shapeType: 'strata:key-value-card',
};
const TABLE: Widget = {
  id: 'table',
  acceptsKinds: ['table-row-set'],
  shapeType: 'strata:table',
};
const TIMELINE: Widget = {
  id: 'timeline',
  acceptsKinds: ['log-stream'],
  shapeType: 'strata:timeline',
};
const FILE_TREE: Widget = {
  id: 'file-tree',
  acceptsKinds: [],
  shapeType: 'strata:file-tree',
};

/**
 * Static map from ResultKind → Widget. Plan 4d's dispatcher uses this to
 * pick which custom shape to instantiate when an agent returns a Result.
 *
 * Each entry must have a corresponding ShapeUtil registered in the
 * canvas's customShapeUtils array (app/src/canvas/Canvas.tsx).
 */
export const WIDGET_REGISTRY: Record<ResultKind, Widget> = {
  'text-document': MARKDOWN,
  'wiki-page': MARKDOWN,
  'code-symbol': CODE_BLOCK,
  'code-file': CODE_BLOCK,
  'code-diff': KEY_VALUE_CARD,
  ticket: TICKET,
  'log-stream': TIMELINE,
  'k8s-resource': KEY_VALUE_CARD,
  'web-page': WEB_EMBED,
  image: KEY_VALUE_CARD,
  'table-row-set': TABLE,
  'metric-series': KEY_VALUE_CARD,
  'chat-message': KEY_VALUE_CARD,
  runbook: KEY_VALUE_CARD,
  'dashboard-embed': KEY_VALUE_CARD,
};

/**
 * All distinct widgets, deduplicated (for use in uniqueness checks etc.)
 */
export const ALL_WIDGETS: Widget[] = [
  MARKDOWN,
  CODE_BLOCK,
  TICKET,
  WEB_EMBED,
  KEY_VALUE_CARD,
  TABLE,
  TIMELINE,
  FILE_TREE,
];

/**
 * Pick a widget for a given ResultKind. Returns the fallback (KeyValueCard)
 * for kinds that aren't in the registry — protects future kinds added to
 * spec §3 from breaking the dispatcher before their widget ships.
 */
export function pickWidgetForKind(kind: ResultKind): Widget {
  return WIDGET_REGISTRY[kind] ?? KEY_VALUE_CARD;
}

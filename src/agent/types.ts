/**
 * Shared types for the agent-loop tool surface.
 *
 * Imported by backend tool handlers AND by the browser dispatcher
 * (via path alias) so the directive contract has one source of truth.
 *
 * Spec: REPLICATION-PROMPT.md §12.
 */

export const WIDGET_KINDS = [
  'markdown',
  'code-block',
  'ticket',
  'web-embed',
  'key-value-card',
  'table',
  'timeline',
  'file-tree',
  'composite',
  'tasks',
  'kanban',
  'sticky-note',
  'generic',
  'time',
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/**
 * Kinds that are valid as a section's `kind` inside a `composite` widget.
 * Composite cannot nest composite.
 */
export const COMPOSITE_SECTION_KINDS = WIDGET_KINDS.filter(
  (k): k is Exclude<WidgetKind, 'composite'> => k !== 'composite',
);

/**
 * Logical placement role chosen by the model when calling place_widget.
 * Each canvas template translates a role to pixel coordinates via
 * `slotForRole` (see app/src/canvas/templates). `node` is the fallback
 * for graph-shaped templates; `timeline` is the time-anchored slot.
 */
export const ROLES = [
  'primary',
  'detail',
  'related',
  'reference',
  'timeline',
  'node',
] as const;
export type Role = (typeof ROLES)[number];

export const TEMPLATE_IDS = [
  'ask-anything',
  'tell-me-about-x',
  'whats-new-since-y',
  'trace-x-everywhere',
] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/**
 * Backend tool handlers return one of these directives in their tool result.
 * The browser receives them via UIMS `tool-output-available` chunks and
 * applies them to tldraw via `applyToolDirective`.
 *
 * `place`/`update`/`focus` ids reference canvas widget ids (server-minted
 * UUIDs from prior place calls). `link`'s `linkId` is its own id; `from`/
 * `to` are widget ids. `switchTemplate.id` is a TemplateId enum value.
 */
export type ToolDirective =
  | {
      type: 'place';
      id: string;
      kind: WidgetKind;
      role: Role;
      payload: Record<string, unknown>;
    }
  | {
      type: 'update';
      id: string;
      payload?: Record<string, unknown>;
      appendSections?: Array<{
        heading?: string;
        kind: Exclude<WidgetKind, 'composite'>;
        payload: Record<string, unknown>;
      }>;
    }
  | {
      type: 'link';
      linkId: string;
      fromId: string;
      toId: string;
      label?: string;
    }
  | { type: 'focus'; id: string }
  | { type: 'clear' }
  | { type: 'switchTemplate'; id: TemplateId }
  | {
      /**
       * Open a new streaming widget — places a scaffold shape on the
       * canvas and flips its meta.streaming flag on. Subsequent
       * `stream-op` directives mutate this widget's payload in place.
       * Renderers read meta.streaming to show streaming-state visuals
       * (caret, skeleton row, etc.).
       */
      type: 'stream-start';
      id: string;
      kind: WidgetKind;
      role: Role;
      scaffold: Record<string, unknown>;
    }
  | {
      /**
       * Apply a single op to a streaming widget. `seq` is monotonic per
       * id; the dispatcher drops out-of-order/duplicate ops.
       */
      type: 'stream-op';
      id: string;
      seq: number;
      op: WidgetStreamOp;
    }
  | {
      /**
       * Close a streaming widget. Flips meta.streaming off so renderers
       * drop streaming chrome. `ok=false` + `error` keeps the partial
       * payload but adds a meta.streamingError badge.
       */
      type: 'stream-end';
      id: string;
      ok: boolean;
      error?: string;
    };

/**
 * Mutation operations for streaming widgets. Each op is idempotent
 * under sequence ordering; the client mutator (app/src/canvas/
 * stream-mutator.ts) applies them to the current shape props.
 *
 * The op surface is intentionally narrow — append-text/rows/field cover
 * the streaming-friendly block types (markdown / table / kv); set-prop
 * is the catchall for arbitrary patches; replace-block is finalization.
 */
export type WidgetStreamOp =
  | { kind: 'append-text'; blockIndex: number; text: string }
  | { kind: 'append-rows'; blockIndex: number; rows: string[][] }
  | {
      kind: 'append-field';
      blockIndex: number;
      field: { key: string; value: string; url?: string };
    }
  | { kind: 'append-block'; block: Record<string, unknown> }
  | { kind: 'replace-block'; blockIndex: number; block: Record<string, unknown> }
  | { kind: 'set-prop'; path: ReadonlyArray<string | number>; value: unknown };

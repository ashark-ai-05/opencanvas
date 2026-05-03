/**
 * Shared types for the agent-loop tool surface (Plan 5).
 * Imported by backend tool handlers AND by the browser dispatcher
 * (via path alias) so the directive contract has one source of truth.
 */

export const WIDGET_KINDS = [
  'markdown',
  'code-block',
  'ticket',
  'web-embed',
  'key-value-card',
] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

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
 */
export type ToolDirective =
  | {
      type: 'place';
      id: string;            // server-minted UUID
      kind: WidgetKind;
      role: Role;
      payload: Record<string, unknown>;
    }
  | {
      type: 'link';
      linkId: string;        // server-minted UUID for the edge
      fromId: string;
      toId: string;
      label?: string;
    }
  | { type: 'focus'; id: string }
  | { type: 'clear' }
  | { type: 'switchTemplate'; id: TemplateId };

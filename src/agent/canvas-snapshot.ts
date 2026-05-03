import { z } from 'zod';
import { WIDGET_KINDS, ROLES, TEMPLATE_IDS } from './types.js';

const WidgetEntry = z.object({
  id: z.string(),
  kind: z.enum(WIDGET_KINDS),
  role: z.enum(ROLES),
  title: z.string(),
  payload: z.record(z.string(), z.unknown()),
});

const Snapshot = z.object({
  activeTemplateId: z.enum(TEMPLATE_IDS),
  widgets: z.array(WidgetEntry),
});

export type CanvasSnapshot = z.infer<typeof Snapshot>;

export const EMPTY_SNAPSHOT: CanvasSnapshot = {
  activeTemplateId: 'ask-anything',
  widgets: [],
};

/**
 * Parse a CanvasSnapshot from arbitrary request input.
 * - undefined / malformed top-level → EMPTY_SNAPSHOT
 * - unknown templateId → fall back to 'ask-anything'
 * - per-widget validation failures: drop the widget, keep the rest
 *
 * This is permissive on purpose — the snapshot is a hint, not the source
 * of truth, and we'd rather degrade gracefully than 400 a chat turn.
 */
export function parseCanvasSnapshot(raw: unknown): CanvasSnapshot {
  if (!raw || typeof raw !== 'object') return EMPTY_SNAPSHOT;
  const obj = raw as Record<string, unknown>;
  const widgets = Array.isArray(obj['widgets']) ? obj['widgets'] : null;
  if (!widgets) return EMPTY_SNAPSHOT;

  const validWidgets: CanvasSnapshot['widgets'] = [];
  for (const w of widgets) {
    const r = WidgetEntry.safeParse(w);
    if (r.success) validWidgets.push(r.data);
  }

  const tplRaw = obj['activeTemplateId'];
  const tpl = TEMPLATE_IDS.find((t) => t === tplRaw) ?? 'ask-anything';

  return { activeTemplateId: tpl, widgets: validWidgets };
}

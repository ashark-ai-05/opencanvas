import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import { z } from 'zod';
import type { WidgetRegistry } from '../../backend/widget-registry.js';
import type { OpenCanvasToolCtx, WithArgs } from './_shared.js';

/**
 * Discovery tool: lists every plugin widget kind currently registered.
 *
 * The list mixes three sources:
 *   - Built-in plugins shipped with the binary (html, chart, mermaid, calendar, …)
 *   - User-saved templates loaded from ~/.opencanvas/templates.json
 *   - Templates registered earlier in this same session via register_widget_kind
 *
 * The agent calls this **first** when the user asks for a custom render —
 * checking whether a fitting template already exists is cheaper than
 * hand-rolling HTML or re-registering.
 *
 * Output: `{ templates: Array<{kind, label?, description?}> }`. Includes
 * the description so the agent can pick the right one without a second
 * round-trip.
 */
const inputShape = {} as const;
const inputSchema = z.object({}).strict();

const TOOL_DESCRIPTION =
  'List every plugin widget kind currently available — built-ins (html, chart, mermaid, calendar, etc.), templates saved by prior sessions (persisted via register_widget_kind), and any new ones registered in this session. Call this FIRST whenever the user asks for a custom visual render. If a fitting template exists, use `place_widget(kind: "<name>", payload: {...})` directly — much cheaper than re-rolling HTML or re-registering.';

function describe(
  registry: WidgetRegistry,
): { templates: Array<{ kind: string; label?: string; description?: string }> } {
  return {
    templates: registry.list().map((d) => ({
      kind: d.kind,
      ...(d.label ? { label: d.label } : {}),
      ...(d.description ? { description: d.description } : {}),
    })),
  };
}

// ─── v1 (Claude SDK) ────────────────────────────────────────────────────
type ListTemplatesToolDef = WithArgs<typeof inputShape, Record<string, never>>;

export function listTemplatesTool(
  getRegistry: () => WidgetRegistry,
): ListTemplatesToolDef {
  const def = claudeTool('list_templates', TOOL_DESCRIPTION, inputShape, async () => {
    const out = describe(getRegistry());
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(out) }],
    };
  });
  return def as unknown as ListTemplatesToolDef;
}

// ─── v2 (AI SDK) ────────────────────────────────────────────────────────
export const listTemplatesToolV2 = (ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema,
    execute: async () => {
      if (!ctx.getWidgetRegistry) {
        return { templates: [] };
      }
      return describe(ctx.getWidgetRegistry());
    },
  });

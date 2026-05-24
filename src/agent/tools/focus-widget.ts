import { z } from 'zod';
import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import type { OpenCanvasToolCtx, WithArgs } from './_shared.js';

const inputShape = {
  id: z.string().describe('canvas widget id'),
};
const inputSchema = z.object(inputShape);

const TOOL_DESCRIPTION = 'Pan and zoom the canvas to a specific widget.';

type FocusArgs = { id: string };

function executeFocus(args: FocusArgs) {
  const directive = { type: 'focus' as const, id: args.id };
  return { ok: true as const, directive };
}

// ─── v1 (Claude SDK) — kept intact during migration ────────────────────
type FocusWidgetToolDef = WithArgs<typeof inputShape, FocusArgs>;

export function focusWidgetTool(): FocusWidgetToolDef {
  const def = claudeTool(
    'focus_widget',
    TOOL_DESCRIPTION,
    inputShape,
    async (args) => {
      const out = executeFocus(args);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(out) },
        ],
      };
    },
  );
  return def as unknown as FocusWidgetToolDef;
}

// ─── v2 (AI SDK) — the future ──────────────────────────────────────────
export const focusWidgetToolV2 = (_ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema,
    execute: async (args) => executeFocus(args),
  });

import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import { z } from 'zod';
import type { CanvasSnapshot } from '../canvas-snapshot.js';
import type { OpenCanvasToolCtx, WithArgs } from './_shared.js';

const inputShape = {
  id: z.string().describe('canvas widget id from read_canvas'),
};
const inputSchema = z.object(inputShape);

interface ReadWidgetArgs {
  id: string;
}

type ReadWidgetResult =
  | { widget: CanvasSnapshot['widgets'][number] }
  | { error: string; notFound: true };

/** Shared body — both v1 and v2 builders close over this. */
function executeReadWidget(
  getSnapshot: () => CanvasSnapshot,
  args: ReadWidgetArgs,
): ReadWidgetResult {
  const snap = getSnapshot();
  const w = snap.widgets.find((x) => x.id === args.id);
  if (!w) {
    return { error: `widget not found: ${args.id}`, notFound: true };
  }
  return { widget: w };
}

const TOOL_DESCRIPTION = 'Read the full payload of one canvas widget.';

// ─── v1 (Claude SDK) — kept intact during migration ────────────────────
type ReadWidgetToolDef = WithArgs<typeof inputShape, ReadWidgetArgs>;

export function readWidgetTool(getSnapshot: () => CanvasSnapshot): ReadWidgetToolDef {
  const def = claudeTool(
    'read_widget',
    TOOL_DESCRIPTION,
    inputShape,
    async (args) => {
      const out = executeReadWidget(getSnapshot, args);
      if ('notFound' in out) {
        return {
          content: [{ type: 'text' as const, text: out.error }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(out) }],
      };
    },
  );
  return def as unknown as ReadWidgetToolDef;
}

// ─── v2 (AI SDK) — the future ──────────────────────────────────────────
export const readWidgetToolV2 = (ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema,
    execute: async (args) => executeReadWidget(ctx.getSnapshot, args),
  });

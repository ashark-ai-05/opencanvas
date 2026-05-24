import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import { z } from 'zod';
import type { CanvasSnapshot } from '../canvas-snapshot.js';
import type { OpenCanvasToolCtx, WithArgs } from './_shared.js';

const inputShape = {} as const;
const inputSchema = z.object({}).strict();

const TOOL_DESCRIPTION = 'Remove all widgets from the canvas.';

function executeClear(getSnapshot: () => CanvasSnapshot) {
  const snap = getSnapshot();
  // `removedIds` was echoed back to the agent but it already knows what
  // was on the canvas (it has the snapshot in context). Omit the list to
  // avoid re-sending all widget ids as a token-wasteful echo. The count
  // is kept for lightweight confirmation feedback.
  const removedCount = snap.widgets.length;
  const directive = { type: 'clear' as const };
  return { ok: true as const, removedCount, directive };
}

// ─── v1 (Claude SDK) — kept intact during migration ────────────────────
type ClearCanvasToolDef = WithArgs<typeof inputShape, Record<string, never>>;

export function clearCanvasTool(getSnapshot: () => CanvasSnapshot): ClearCanvasToolDef {
  const def = claudeTool(
    'clear_canvas',
    TOOL_DESCRIPTION,
    inputShape,
    async () => {
      const out = executeClear(getSnapshot);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(out) },
        ],
      };
    },
  );
  return def as unknown as ClearCanvasToolDef;
}

// ─── v2 (AI SDK) — the future ──────────────────────────────────────────
export const clearCanvasToolV2 = (ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema,
    execute: async () => executeClear(ctx.getSnapshot),
  });

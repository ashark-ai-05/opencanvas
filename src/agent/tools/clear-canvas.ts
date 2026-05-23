import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CanvasSnapshot } from '../canvas-snapshot.js';
import type { WithArgs } from './_shared.js';

const inputShape = {} as const;

type ClearCanvasToolDef = WithArgs<typeof inputShape, Record<string, never>>;

export function clearCanvasTool(getSnapshot: () => CanvasSnapshot): ClearCanvasToolDef {
  const def = tool(
    'clear_canvas',
    'Remove all widgets from the canvas.',
    inputShape,
    async () => {
      const snap = getSnapshot();
      // `removedIds` was echoed back to the agent but it already knows what
      // was on the canvas (it has the snapshot in context). Omit the list to
      // avoid re-sending all widget ids as a token-wasteful echo. The count
      // is kept for lightweight confirmation feedback.
      const removedCount = snap.widgets.length;
      const directive = { type: 'clear' as const };
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ ok: true, removedCount, directive }) },
        ],
      };
    },
  );
  return def as unknown as ClearCanvasToolDef;
}

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
      const removedIds = snap.widgets.map((w) => w.id);
      const directive = { type: 'clear' as const };
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ ok: true, removedIds, directive }) },
        ],
      };
    },
  );
  return def as unknown as ClearCanvasToolDef;
}

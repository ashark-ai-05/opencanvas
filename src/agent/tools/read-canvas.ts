import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CanvasSnapshot } from '../canvas-snapshot.js';
import type { WithArgs } from './_shared.js';

const inputShape = {} as const;

type ReadCanvasToolDef = WithArgs<typeof inputShape, Record<string, never>>;

export function readCanvasTool(getSnapshot: () => CanvasSnapshot): ReadCanvasToolDef {
  const def = tool(
    'read_canvas',
    'List widgets currently on the canvas (summary only).',
    inputShape,
    async () => {
      const snap = getSnapshot();
      const summary = snap.widgets.map((w) => ({
        id: w.id,
        kind: w.kind,
        role: w.role,
        title: w.title,
      }));
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ widgets: summary }) },
        ],
      };
    },
  );
  return def as unknown as ReadCanvasToolDef;
}

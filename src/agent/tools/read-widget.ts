import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { CanvasSnapshot } from '../canvas-snapshot.js';
import type { WithArgs } from './_shared.js';

const inputShape = {
  id: z.string().describe('canvas widget id from read_canvas'),
};

type ReadWidgetToolDef = WithArgs<typeof inputShape, { id: string }>;

export function readWidgetTool(getSnapshot: () => CanvasSnapshot): ReadWidgetToolDef {
  const def = tool(
    'read_widget',
    'Read the full payload of one canvas widget.',
    inputShape,
    async (args) => {
      const snap = getSnapshot();
      const w = snap.widgets.find((x) => x.id === args.id);
      if (!w) {
        return {
          content: [{ type: 'text' as const, text: `widget not found: ${args.id}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ widget: w }) }],
      };
    },
  );
  return def as unknown as ReadWidgetToolDef;
}

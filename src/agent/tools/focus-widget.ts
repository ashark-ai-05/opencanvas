import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { WithArgs } from './_shared.js';

const inputShape = {
  id: z.string().describe('canvas widget id'),
};

type FocusWidgetToolDef = WithArgs<typeof inputShape, { id: string }>;

export function focusWidgetTool(): FocusWidgetToolDef {
  const def = tool(
    'focus_widget',
    'Pan and zoom the canvas to a specific widget.',
    inputShape,
    async (args) => {
      const directive = { type: 'focus' as const, id: args.id };
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ ok: true, directive }) },
        ],
      };
    },
  );
  return def as unknown as FocusWidgetToolDef;
}

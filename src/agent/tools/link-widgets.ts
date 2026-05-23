import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { WithArgs } from './_shared.js';

const inputShape = {
  fromId: z.string().describe('source widget id'),
  toId: z.string().describe('target widget id'),
  label: z.string().optional().describe('edge label'),
};

type LinkWidgetsArgs = {
  fromId: string;
  toId: string;
  label?: string;
};

type LinkWidgetsToolDef = WithArgs<typeof inputShape, LinkWidgetsArgs>;

export function linkWidgetsTool(): LinkWidgetsToolDef {
  const def = tool(
    'link_widgets',
    'Draw a labeled visual edge between two canvas widgets.',
    inputShape,
    async (args) => {
      if (args.fromId === args.toId) {
        return {
          content: [{ type: 'text' as const, text: 'self-link not allowed: fromId === toId' }],
          isError: true,
        };
      }
      const linkId = randomUUID();
      const directive = {
        type: 'link' as const,
        linkId,
        fromId: args.fromId,
        toId: args.toId,
        ...(args.label !== undefined ? { label: args.label } : {}),
      };
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ ok: true, linkId, directive }) },
        ],
      };
    },
  );
  return def as unknown as LinkWidgetsToolDef;
}

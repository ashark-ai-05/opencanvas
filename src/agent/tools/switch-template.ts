import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { TEMPLATE_IDS } from '../types.js';
import type { WithArgs } from './_shared.js';

const inputShape = {
  id: z
    .enum(TEMPLATE_IDS)
    .describe('template id: ask-anything | tell-me-about-x | whats-new-since-y | trace-x-everywhere'),
};

type SwitchTemplateArgs = { id: (typeof TEMPLATE_IDS)[number] };
type SwitchTemplateToolDef = WithArgs<typeof inputShape, SwitchTemplateArgs>;

export function switchTemplateTool(): SwitchTemplateToolDef {
  const def = tool(
    'switch_template',
    'Switch the active canvas template; existing widgets re-flow.',
    inputShape,
    async (args) => {
      // Defensive: if the SDK skipped Zod (shouldn't), guard here too.
      if (!TEMPLATE_IDS.includes(args.id as (typeof TEMPLATE_IDS)[number])) {
        return {
          content: [{ type: 'text' as const, text: `unknown template: ${args.id}` }],
          isError: true,
        };
      }
      const directive = { type: 'switchTemplate' as const, id: args.id };
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ ok: true, directive }) },
        ],
      };
    },
  );
  return def as unknown as SwitchTemplateToolDef;
}

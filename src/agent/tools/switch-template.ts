import { z } from 'zod';
import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import { TEMPLATE_IDS } from '../types.js';
import type { OpenCanvasToolCtx, WithArgs } from './_shared.js';

const inputShape = {
  id: z
    .enum(TEMPLATE_IDS)
    .describe('template id: ask-anything | tell-me-about-x | whats-new-since-y | trace-x-everywhere'),
};
const inputSchema = z.object(inputShape);

const TOOL_DESCRIPTION = 'Switch the active canvas template; existing widgets re-flow.';

type SwitchTemplateArgs = { id: (typeof TEMPLATE_IDS)[number] };

type SwitchTemplateResult =
  | { ok: true; directive: { type: 'switchTemplate'; id: (typeof TEMPLATE_IDS)[number] } }
  | { ok: false; error: string };

function executeSwitchTemplate(args: SwitchTemplateArgs): SwitchTemplateResult {
  // Defensive: if Zod is skipped (shouldn't), guard here too.
  if (!TEMPLATE_IDS.includes(args.id as (typeof TEMPLATE_IDS)[number])) {
    return { ok: false, error: `unknown template: ${args.id}` };
  }
  const directive = { type: 'switchTemplate' as const, id: args.id };
  return { ok: true, directive };
}

// ─── v1 (Claude SDK) — kept intact during migration ────────────────────
type SwitchTemplateToolDef = WithArgs<typeof inputShape, SwitchTemplateArgs>;

export function switchTemplateTool(): SwitchTemplateToolDef {
  const def = claudeTool(
    'switch_template',
    TOOL_DESCRIPTION,
    inputShape,
    async (args) => {
      const out = executeSwitchTemplate(args);
      if (!out.ok) {
        return {
          content: [{ type: 'text' as const, text: out.error }],
          isError: true,
        };
      }
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(out) },
        ],
      };
    },
  );
  return def as unknown as SwitchTemplateToolDef;
}

// ─── v2 (AI SDK) — the future ──────────────────────────────────────────
export const switchTemplateToolV2 = (_ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema,
    execute: async (args) => executeSwitchTemplate(args),
  });

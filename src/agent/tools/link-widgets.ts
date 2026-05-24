import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import type { OpenCanvasToolCtx, WithArgs } from './_shared.js';

const inputShape = {
  fromId: z.string().describe('source widget id'),
  toId: z.string().describe('target widget id'),
  label: z.string().optional().describe('edge label'),
};
const inputSchema = z.object(inputShape);

const TOOL_DESCRIPTION = 'Draw a labeled visual edge between two canvas widgets.';

type LinkWidgetsArgs = {
  fromId: string;
  toId: string;
  label?: string;
};

type LinkDirective = {
  type: 'link';
  linkId: string;
  fromId: string;
  toId: string;
  label?: string;
};

type LinkWidgetsResult =
  | { ok: true; linkId: string; directive: LinkDirective }
  | { ok: false; error: string };

function executeLinkWidgets(args: LinkWidgetsArgs): LinkWidgetsResult {
  if (args.fromId === args.toId) {
    return { ok: false, error: 'self-link not allowed: fromId === toId' };
  }
  const linkId = randomUUID();
  const directive: LinkDirective = {
    type: 'link',
    linkId,
    fromId: args.fromId,
    toId: args.toId,
    ...(args.label !== undefined ? { label: args.label } : {}),
  };
  return { ok: true, linkId, directive };
}

// ─── v1 (Claude SDK) — kept intact during migration ────────────────────
type LinkWidgetsToolDef = WithArgs<typeof inputShape, LinkWidgetsArgs>;

export function linkWidgetsTool(): LinkWidgetsToolDef {
  const def = claudeTool(
    'link_widgets',
    TOOL_DESCRIPTION,
    inputShape,
    async (args) => {
      const out = executeLinkWidgets(args);
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
  return def as unknown as LinkWidgetsToolDef;
}

// ─── v2 (AI SDK) — the future ──────────────────────────────────────────
export const linkWidgetsToolV2 = (_ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema,
    execute: async (args) => executeLinkWidgets(args),
  });

import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import { z } from 'zod';
import type { CanvasSnapshot } from '../canvas-snapshot.js';
import type { OpenCanvasToolCtx, WithArgs } from './_shared.js';

const inputShape = {} as const;
const inputSchema = z.object({}).strict();

// ─── v1 (Claude SDK) — kept intact during migration ────────────────────
type ReadCanvasToolDef = WithArgs<typeof inputShape, Record<string, never>>;

export function readCanvasTool(getSnapshot: () => CanvasSnapshot): ReadCanvasToolDef {
  const def = claudeTool(
    'read_canvas',
    'List widgets currently on the canvas (summary only).',
    inputShape,
    async () => buildResult(getSnapshot),
  );
  return def as unknown as ReadCanvasToolDef;
}

// ─── v2 (AI SDK) — the future ──────────────────────────────────────────
export const readCanvasToolV2 = (ctx: OpenCanvasToolCtx) =>
  tool({
    description: 'List widgets currently on the canvas (summary only).',
    inputSchema,
    execute: async () => buildResult(ctx.getSnapshot),
  });

// ─── Shared body ───────────────────────────────────────────────────────
function buildResult(getSnapshot: () => CanvasSnapshot) {
  const snap = getSnapshot();
  const widgets = snap.widgets.map((w) => ({
    id: w.id,
    kind: w.kind,
    role: w.role,
    title: w.title,
  }));
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify({ widgets }) },
    ],
  };
}

import { z } from 'zod';
import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import type { OpenCanvasToolCtx, WithArgs } from './_shared.js';
import type { NotebookStore } from '../../backend/notebook-store.js';

const inputShape = {
  text: z.string().describe('Markdown text to append to the notepad'),
  separator: z
    .string()
    .optional()
    .describe('String inserted between existing content and new text (default: two newlines — a paragraph break). Pass a different separator only if you have a reason.'),
};

export type AppendToNotesArgs = {
  text: string;
  separator?: string;
};

type AppendToNotesToolDef = WithArgs<typeof inputShape, AppendToNotesArgs>;

const TOOL_DESCRIPTION =
  'Append markdown text to the user\'s notepad. Use to capture decisions, summaries, or notes the user wants saved. Default separator is two newlines (paragraph break) — pass a different separator only if you have a reason.';

/** Shared body — both v1 and v2 builders close over this. */
async function executeAppendToNotes(
  getStore: () => Promise<NotebookStore>,
  args: AppendToNotesArgs,
) {
  const store = await getStore();
  const current = store.getNote();
  const separator = args.separator ?? '\n\n';
  const newBody = current.body ? current.body + separator + args.text : args.text;
  const saved = store.saveNote(newBody);
  return { ok: true as const, body: saved.body, updated_at: saved.updatedAt };
}

// ─── v1 (Claude SDK) — kept intact during migration ────────────────────
export function appendToNotesTool(
  getStore: () => Promise<NotebookStore>,
): AppendToNotesToolDef {
  const def = claudeTool(
    'append_to_notes',
    TOOL_DESCRIPTION,
    inputShape,
    async (args) => {
      const out = await executeAppendToNotes(getStore, args);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(out) },
        ],
      };
    },
  );
  return def as unknown as AppendToNotesToolDef;
}

// ─── v2 (AI SDK) — the future ──────────────────────────────────────────
export const appendToNotesToolV2 = (ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema: z.object(inputShape),
    execute: async (args: AppendToNotesArgs) => {
      if (!ctx.getNotebookStore) {
        throw new Error('append_to_notes is unavailable: no notebook store configured.');
      }
      return executeAppendToNotes(ctx.getNotebookStore, args);
    },
  });

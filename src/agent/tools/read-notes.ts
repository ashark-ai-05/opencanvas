import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import { z } from 'zod';
import type { OpenCanvasToolCtx, WithArgs } from './_shared.js';
import type { NotebookStore } from '../../backend/notebook-store.js';

const inputShape = {} as const;
const inputSchema = z.object({}).strict();

type ReadNotesArgs = Record<string, never>;

type ReadNotesResult =
  | { empty: true }
  | { body: string; updated_at: number };

const TOOL_DESCRIPTION =
  'Read the user\'s persistent notepad. The notepad is markdown — anything they\'ve been jotting across all conversations. Use this when answering questions about their work-in-progress, ideas, or context they\'ve captured.';

/** Shared body — both v1 and v2 builders close over this. */
async function executeReadNotes(
  getStore: () => Promise<NotebookStore>,
): Promise<ReadNotesResult> {
  const store = await getStore();
  const note = store.getNote();
  if (!note.body) {
    return { empty: true };
  }
  return { body: note.body, updated_at: note.updatedAt };
}

// ─── v1 (Claude SDK) — kept intact during migration ────────────────────
type ReadNotesToolDef = WithArgs<typeof inputShape, ReadNotesArgs>;

export function readNotesTool(
  getStore: () => Promise<NotebookStore>,
): ReadNotesToolDef {
  const def = claudeTool(
    'read_notes',
    TOOL_DESCRIPTION,
    inputShape,
    async (_args) => {
      const out = await executeReadNotes(getStore);
      if ('empty' in out) {
        return {
          content: [{ type: 'text' as const, text: '(notepad is empty)' }],
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(out) }],
      };
    },
  );
  return def as unknown as ReadNotesToolDef;
}

// ─── v2 (AI SDK) — the future ──────────────────────────────────────────
export const readNotesToolV2 = (ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema,
    execute: async () => {
      if (!ctx.getNotebookStore) {
        return { empty: true as const };
      }
      return executeReadNotes(ctx.getNotebookStore);
    },
  });

import { z } from 'zod';
import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import type { OpenCanvasToolCtx, WithArgs } from './_shared.js';
import type { NotebookStore } from '../../backend/notebook-store.js';

const inputShape = {
  id: z.string().describe('The id of the task to mark as done'),
};

export type CompleteTaskArgs = {
  id: string;
};

type CompleteTaskToolDef = WithArgs<typeof inputShape, CompleteTaskArgs>;

const TOOL_DESCRIPTION =
  'Mark a task done by id. Use after the user says they finished something. Use list/read tools first if you don\'t have the id.';

type CompleteTaskResult =
  | { ok: true; task: ReturnType<NotebookStore['updateTask']> }
  | { ok: false; error: string };

/** Shared body — both v1 and v2 builders close over this. */
async function executeCompleteTask(
  getStore: () => Promise<NotebookStore>,
  args: CompleteTaskArgs,
): Promise<CompleteTaskResult> {
  const store = await getStore();
  const task = store.updateTask(args.id, { done: true });
  if (!task) {
    return { ok: false, error: `Unknown task id: ${args.id}` };
  }
  return { ok: true, task };
}

// ─── v1 (Claude SDK) — kept intact during migration ────────────────────
export function completeTaskTool(
  getStore: () => Promise<NotebookStore>,
): CompleteTaskToolDef {
  const def = claudeTool(
    'complete_task',
    TOOL_DESCRIPTION,
    inputShape,
    async (args) => {
      const out = await executeCompleteTask(getStore, args);
      if (!out.ok) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(out) },
          ],
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
  return def as unknown as CompleteTaskToolDef;
}

// ─── v2 (AI SDK) — the future ──────────────────────────────────────────
export const completeTaskToolV2 = (ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema: z.object(inputShape),
    execute: async (args: CompleteTaskArgs) => {
      if (!ctx.getNotebookStore) {
        throw new Error('complete_task is unavailable: no notebook store configured.');
      }
      return executeCompleteTask(ctx.getNotebookStore, args);
    },
  });

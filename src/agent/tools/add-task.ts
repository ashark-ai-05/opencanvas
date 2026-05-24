import { z } from 'zod';
import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import type { OpenCanvasToolCtx, WithArgs } from './_shared.js';
import type { NotebookStore } from '../../backend/notebook-store.js';

const inputShape = {
  title: z.string().min(1).describe('Task title'),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Due date in YYYY-MM-DD format; resolve relative dates against today's date BEFORE calling"),
  notes: z.string().optional().describe('Optional markdown notes for the task'),
};

export type AddTaskArgs = {
  title: string;
  due_date?: string;
  notes?: string;
};

type AddTaskToolDef = WithArgs<typeof inputShape, AddTaskArgs>;

const TOOL_DESCRIPTION =
  'Add a task to the user\'s notebook. Use when the user asks to remember a TODO, schedule something, or "don\'t let me forget X". due_date is YYYY-MM-DD; resolve relative dates ("Friday", "next Monday", "tomorrow") against today\'s date BEFORE calling. Returns the new task with its assigned id.';

/** Shared body — both v1 and v2 builders close over this. */
async function executeAddTask(
  getStore: () => Promise<NotebookStore>,
  args: AddTaskArgs,
) {
  const store = await getStore();
  const task = store.createTask({
    title: args.title,
    dueDate: args.due_date ?? null,
    notes: args.notes ?? null,
  });
  return { ok: true as const, task };
}

// ─── v1 (Claude SDK) — kept intact during migration ────────────────────
export function addTaskTool(
  getStore: () => Promise<NotebookStore>,
): AddTaskToolDef {
  const def = claudeTool(
    'add_task',
    TOOL_DESCRIPTION,
    inputShape,
    async (args) => {
      const out = await executeAddTask(getStore, args);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(out) },
        ],
      };
    },
  );
  return def as unknown as AddTaskToolDef;
}

// ─── v2 (AI SDK) — the future ──────────────────────────────────────────
export const addTaskToolV2 = (ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema: z.object(inputShape),
    execute: async (args: AddTaskArgs) => {
      if (!ctx.getNotebookStore) {
        throw new Error('add_task is unavailable: no notebook store configured.');
      }
      return executeAddTask(ctx.getNotebookStore, args);
    },
  });

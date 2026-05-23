import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { WithArgs } from './_shared.js';
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

type AddTaskArgs = {
  title: string;
  due_date?: string;
  notes?: string;
};

type AddTaskToolDef = WithArgs<typeof inputShape, AddTaskArgs>;

export function addTaskTool(
  getStore: () => Promise<NotebookStore>,
): AddTaskToolDef {
  const def = tool(
    'add_task',
    'Add a task to the user\'s notebook. Use when the user asks to remember a TODO, schedule something, or "don\'t let me forget X". due_date is YYYY-MM-DD; resolve relative dates ("Friday", "next Monday", "tomorrow") against today\'s date BEFORE calling. Returns the new task with its assigned id.',
    inputShape,
    async (args) => {
      const store = await getStore();
      const task = store.createTask({
        title: args.title,
        dueDate: args.due_date ?? null,
        notes: args.notes ?? null,
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ ok: true, task }) },
        ],
      };
    },
  );
  return def as unknown as AddTaskToolDef;
}

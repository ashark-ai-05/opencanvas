import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { WithArgs } from './_shared.js';
import type { NotebookStore } from '../../backend/notebook-store.js';

const inputShape = {
  id: z.string().describe('The id of the task to mark as done'),
};

type CompleteTaskArgs = {
  id: string;
};

type CompleteTaskToolDef = WithArgs<typeof inputShape, CompleteTaskArgs>;

export function completeTaskTool(
  getStore: () => Promise<NotebookStore>,
): CompleteTaskToolDef {
  const def = tool(
    'complete_task',
    'Mark a task done by id. Use after the user says they finished something. Use list/read tools first if you don\'t have the id.',
    inputShape,
    async (args) => {
      const store = await getStore();
      const task = store.updateTask(args.id, { done: true });
      if (!task) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: false, error: `Unknown task id: ${args.id}` }),
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ ok: true, task }) },
        ],
      };
    },
  );
  return def as unknown as CompleteTaskToolDef;
}

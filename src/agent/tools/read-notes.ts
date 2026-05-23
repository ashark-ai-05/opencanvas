import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { WithArgs } from './_shared.js';
import type { NotebookStore } from '../../backend/notebook-store.js';

const inputShape = {};

type ReadNotesArgs = Record<string, never>;

type ReadNotesToolDef = WithArgs<typeof inputShape, ReadNotesArgs>;

export function readNotesTool(
  getStore: () => Promise<NotebookStore>,
): ReadNotesToolDef {
  const def = tool(
    'read_notes',
    'Read the user\'s persistent notepad. The notepad is markdown — anything they\'ve been jotting across all conversations. Use this when answering questions about their work-in-progress, ideas, or context they\'ve captured.',
    inputShape,
    async (_args) => {
      const store = await getStore();
      const note = store.getNote();
      if (!note.body) {
        return {
          content: [
            { type: 'text' as const, text: '(notepad is empty)' },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ body: note.body, updated_at: note.updatedAt }),
          },
        ],
      };
    },
  );
  return def as unknown as ReadNotesToolDef;
}

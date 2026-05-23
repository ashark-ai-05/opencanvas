import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { WithArgs } from './_shared.js';
import type { NotebookStore } from '../../backend/notebook-store.js';

const inputShape = {
  text: z.string().describe('Markdown text to append to the notepad'),
  separator: z
    .string()
    .optional()
    .describe('String inserted between existing content and new text (default: two newlines — a paragraph break). Pass a different separator only if you have a reason.'),
};

type AppendToNotesArgs = {
  text: string;
  separator?: string;
};

type AppendToNotesToolDef = WithArgs<typeof inputShape, AppendToNotesArgs>;

export function appendToNotesTool(
  getStore: () => Promise<NotebookStore>,
): AppendToNotesToolDef {
  const def = tool(
    'append_to_notes',
    'Append markdown text to the user\'s notepad. Use to capture decisions, summaries, or notes the user wants saved. Default separator is two newlines (paragraph break) — pass a different separator only if you have a reason.',
    inputShape,
    async (args) => {
      const store = await getStore();
      const current = store.getNote();
      const separator = args.separator ?? '\n\n';
      const newBody = current.body ? current.body + separator + args.text : args.text;
      const saved = store.saveNote(newBody);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ok: true, body: saved.body, updated_at: saved.updatedAt }),
          },
        ],
      };
    },
  );
  return def as unknown as AppendToNotesToolDef;
}

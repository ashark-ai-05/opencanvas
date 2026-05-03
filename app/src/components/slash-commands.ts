import { toast } from 'sonner';
import { useChatActions } from '../state/chat-actions-store';
import { useTemplateStore } from '../state/template-store';
import { TEMPLATES_BY_ID } from '../canvas/templates';
import type { CanvasTemplate } from '../canvas/templates';

/**
 * Slash-command surface for the chat input. A command starts with "/"
 * followed by a verb; arguments are space-separated.
 *
 * Commands are intercepted BEFORE they reach the LLM — a /clear never
 * sends a message to the agent, it just runs the local handler.
 */
export type SlashCommand = {
  name: string;
  args?: string;          // human-readable args hint
  description: string;
  /** Returns false if the command was unknown / args invalid (then we
   *  fall back to sending it to the LLM as a message). */
  run: (args: string[]) => boolean;
};

const TEMPLATE_IDS = Object.keys(TEMPLATES_BY_ID) as CanvasTemplate['id'][];

export const COMMANDS: SlashCommand[] = [
  {
    name: 'clear',
    description: 'Clear chat + canvas (same as the New button).',
    run: () => {
      const newChat = useChatActions.getState().newChat;
      if (!newChat) {
        toast.error('Chat not ready');
        return true;
      }
      newChat();
      return true;
    },
  },
  {
    name: 'template',
    args: '<id>',
    description: `Switch active canvas template. Options: ${TEMPLATE_IDS.join(', ')}.`,
    run: (args) => {
      const id = args[0];
      if (!id) {
        toast.error('Usage: /template <id>', {
          description: TEMPLATE_IDS.join(', '),
        });
        return true;
      }
      if (!(id in TEMPLATES_BY_ID)) {
        toast.error(`Unknown template: ${id}`, {
          description: `Try: ${TEMPLATE_IDS.join(', ')}`,
        });
        return true;
      }
      useTemplateStore.getState().setActiveTemplateId(id as CanvasTemplate['id']);
      toast(`Template → ${TEMPLATES_BY_ID[id as CanvasTemplate['id']].name}`);
      return true;
    },
  },
  {
    name: 'help',
    description: 'Show available commands.',
    run: () => {
      const lines = COMMANDS.map((c) => `/${c.name}${c.args ? ' ' + c.args : ''} — ${c.description}`);
      toast('Slash commands', {
        description: lines.join('\n'),
        duration: 8000,
      });
      return true;
    },
  },
];

/**
 * Match an input string against the command registry. Returns true if the
 * input was handled (and should NOT be sent to the LLM); false otherwise.
 */
export function tryRunCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return false;
  const [head, ...args] = trimmed.slice(1).split(/\s+/);
  if (!head) return false;
  const cmd = COMMANDS.find((c) => c.name === head);
  if (!cmd) {
    toast.error(`Unknown command: /${head}`, {
      description: 'Try /help.',
    });
    return true; // consumed even if invalid — don't send "/foo" to the LLM
  }
  return cmd.run(args);
}

/**
 * Filter COMMANDS by a partial name (the chars after "/"). Used by the
 * suggestion popover.
 */
export function suggestCommands(partial: string): SlashCommand[] {
  const q = partial.toLowerCase();
  return COMMANDS.filter((c) => c.name.toLowerCase().startsWith(q));
}

import { toast } from 'sonner';
import { useChatActions } from '../state/chat-actions-store';
import { useTemplateStore } from '../state/template-store';
import { TEMPLATES_BY_ID } from '../canvas/templates';
import type { CanvasTemplate } from '../canvas/templates';
import { getEditor } from '../state/editor-ref';
import { applyToolDirective } from '../canvas/dispatcher';
import {
  exportCanvasAsPng,
  exportCanvasAsMarkdown,
  downloadText,
} from '../canvas/export';

/**
 * How many opencanvas:* widgets the user currently has selected. Used by
 * the selection-scoped slash commands to (a) error helpfully when no
 * selection exists and (b) include the count in the prompt framing.
 */
function selectedWidgetCount(): number {
  const editor = getEditor();
  if (!editor) return 0;
  const ids =
    (editor as unknown as { getSelectedShapeIds?: () => string[] })
      .getSelectedShapeIds?.() ?? [];
  const shapes = (
    editor as unknown as {
      getCurrentPageShapes: () => Array<{ id: string; type: string }>;
    }
  ).getCurrentPageShapes();
  const opencanvasIds = new Set(
    shapes.filter((s) => s.type.startsWith('opencanvas:')).map((s) => s.id),
  );
  return ids.filter((id) => opencanvasIds.has(id)).length;
}

/**
 * Send a selection-scoped chat message. Frames the agent's prompt so
 * it knows the user intends ops over the selection (whose ids the
 * snapshot already carries via canvasSnapshot.selectedIds). The agent
 * can read those ids + decide which tool to call (read_widget,
 * place_widget, update_widget, etc.).
 */
function sendSelectionChat(intent: string): boolean {
  const count = selectedWidgetCount();
  if (count === 0) {
    toast.error('Select one or more widgets first', {
      description: 'Click a card on the canvas, then re-run the command.',
    });
    return true;
  }
  const sendChat = useChatActions.getState().sendChat;
  if (!sendChat) {
    toast.error('Chat not ready');
    return true;
  }
  const noun = count === 1 ? 'widget' : 'widgets';
  sendChat(
    `${intent} (Scope: the ${count} selected ${noun}. Their ids are in the snapshot's selectedIds; use read_widget on each, then place a single new widget with the result.)`,
  );
  return true;
}

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
    name: 'team',
    args: '<prompt>',
    description: 'Run a 3-agent team (Researcher → Builder → Critic) on a prompt.',
    run: (args) => {
      const text = args.join(' ').trim();
      if (!text) {
        toast.error('Usage: /team <your prompt>');
        return true;
      }
      const sendTeam = useChatActions.getState().sendTeam;
      if (!sendTeam) {
        toast.error('Chat not ready');
        return true;
      }
      sendTeam(text);
      return true;
    },
  },
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
  // ────────────────────────────────────────────────────────────────
  // Selection-scoped agent ops. Each one sends a normal chat turn
  // with prompt framing that points the agent at canvasSnapshot
  // .selectedIds (already populated by the snapshot writer).
  // ────────────────────────────────────────────────────────────────
  {
    name: 'summarize-selected',
    description: 'Summarize the selected widgets into a single markdown card.',
    run: () =>
      sendSelectionChat(
        'Read each selected widget and produce one tight markdown widget summarising them. Place it as kind=markdown, role=detail.',
      ),
  },
  {
    name: 'merge-selected',
    description: 'Merge the selected widgets into one composite card.',
    run: () =>
      sendSelectionChat(
        'Read each selected widget and place a single composite widget whose sections preserve each as a section. Use the existing payload for each section verbatim. Composite role=primary.',
      ),
  },
  {
    name: 'contrast-selected',
    description: 'Highlight differences between the selected widgets (table).',
    run: () =>
      sendSelectionChat(
        'Read each selected widget and place ONE table widget whose columns are the selected widgets and rows are the dimensions on which they differ. role=detail.',
      ),
  },
  {
    name: 'rebuild-as-table',
    description: 'Reshape the selected widgets into a single table.',
    run: () =>
      sendSelectionChat(
        'Read each selected widget and place a table whose rows are entries from the selection and columns capture their key fields. role=detail.',
      ),
  },
  // ────────────────────────────────────────────────────────────────
  // Layout
  // ────────────────────────────────────────────────────────────────
  {
    name: 'tidy',
    description: 'Re-layout existing widgets using the active template.',
    run: () => {
      const editor = getEditor();
      if (!editor) {
        toast.error('Canvas not ready');
        return true;
      }
      const tplId = useTemplateStore.getState().activeTemplateId;
      const tpl = TEMPLATES_BY_ID[tplId];
      const viewport = editor.getViewportPageBounds();

      // Group widgets by role; for each role re-call slotForRole with
      // increasing occupancy. Animate to the new positions.
      const shapes = (editor.getCurrentPageShapes() as Array<{
        id: string;
        type: string;
        meta?: Record<string, unknown>;
        x: number;
        y: number;
      }>).filter((s) => s.type.startsWith('opencanvas:'));

      if (shapes.length === 0) {
        toast('Nothing to tidy — canvas is empty');
        return true;
      }

      // Process roles in a stable order so the layout is reproducible.
      const ROLE_ORDER = [
        'primary',
        'detail',
        'related',
        'reference',
        'timeline',
        'node',
      ] as const;
      const byRole = new Map<string, typeof shapes>();
      for (const s of shapes) {
        const role = ((s.meta?.['role'] as string) ?? 'primary');
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role)!.push(s);
      }

      editor.batch(() => {
        for (const role of ROLE_ORDER) {
          const list = byRole.get(role) ?? [];
          list.forEach((shape, i) => {
            const slot = tpl.slotForRole(role as never, i, viewport);
            (
              editor as unknown as {
                animateShape: (
                  shape: { id: string; type: string; x: number; y: number },
                  opts: { animation: { duration: number } },
                ) => void;
              }
            ).animateShape(
              {
                id: shape.id,
                type: shape.type,
                x: slot.x,
                y: slot.y,
              },
              { animation: { duration: 280 } },
            );
          });
        }
      });
      toast(`Tidied ${shapes.length} widget${shapes.length === 1 ? '' : 's'}`);
      return true;
    },
  },
  {
    name: 'pin-selected',
    description: 'Pin selected widgets so /clear and clear-canvas leave them.',
    run: () => {
      const editor = getEditor();
      if (!editor) {
        toast.error('Canvas not ready');
        return true;
      }
      const ids =
        (editor as unknown as { getSelectedShapeIds?: () => string[] })
          .getSelectedShapeIds?.() ?? [];
      const shapes = (
        editor as unknown as {
          getCurrentPageShapes: () => Array<{
            id: string;
            type: string;
            meta?: Record<string, unknown>;
          }>;
        }
      )
        .getCurrentPageShapes()
        .filter(
          (s) => s.type.startsWith('opencanvas:') && ids.includes(s.id),
        );
      if (shapes.length === 0) {
        toast.error('Select one or more widgets first');
        return true;
      }
      editor.batch(() => {
        for (const s of shapes) {
          editor.updateShape({
            id: s.id as never,
            type: s.type as never,
            meta: { ...(s.meta ?? {}), pinned: true } as never,
          } as never);
        }
      });
      toast(`Pinned ${shapes.length} widget${shapes.length === 1 ? '' : 's'}`);
      return true;
    },
  },
  {
    name: 'unpin-selected',
    description: 'Unpin selected widgets.',
    run: () => {
      const editor = getEditor();
      if (!editor) {
        toast.error('Canvas not ready');
        return true;
      }
      const ids =
        (editor as unknown as { getSelectedShapeIds?: () => string[] })
          .getSelectedShapeIds?.() ?? [];
      const shapes = (
        editor as unknown as {
          getCurrentPageShapes: () => Array<{
            id: string;
            type: string;
            meta?: Record<string, unknown>;
          }>;
        }
      )
        .getCurrentPageShapes()
        .filter(
          (s) => s.type.startsWith('opencanvas:') && ids.includes(s.id),
        );
      if (shapes.length === 0) {
        toast.error('Select one or more widgets first');
        return true;
      }
      editor.batch(() => {
        for (const s of shapes) {
          const meta = { ...(s.meta ?? {}) };
          delete (meta as { pinned?: unknown }).pinned;
          editor.updateShape({
            id: s.id as never,
            type: s.type as never,
            meta: meta as never,
          } as never);
        }
      });
      toast(`Unpinned ${shapes.length} widget${shapes.length === 1 ? '' : 's'}`);
      return true;
    },
  },
  {
    name: 'remove-selected',
    description: 'Delete the selected widgets (pinned ones are skipped).',
    run: () => {
      const editor = getEditor();
      if (!editor) return true;
      const ids =
        (editor as unknown as { getSelectedShapeIds?: () => string[] })
          .getSelectedShapeIds?.() ?? [];
      const shapes = (
        editor as unknown as {
          getCurrentPageShapes: () => Array<{
            id: string;
            type: string;
            meta?: Record<string, unknown>;
          }>;
        }
      )
        .getCurrentPageShapes()
        .filter(
          (s) =>
            s.type.startsWith('opencanvas:') &&
            ids.includes(s.id) &&
            (s.meta as { pinned?: boolean } | undefined)?.pinned !== true,
        );
      if (shapes.length === 0) {
        toast.error('Nothing to remove');
        return true;
      }
      const tplId = useTemplateStore.getState().activeTemplateId;
      for (const s of shapes) {
        applyToolDirective(
          editor,
          { type: 'remove', id: s.id.replace(/^shape:/, '') },
          tplId,
        );
      }
      toast(`Removed ${shapes.length} widget${shapes.length === 1 ? '' : 's'}`);
      return true;
    },
  },
  {
    name: 'embed',
    args: '<url>',
    description: 'Embed any URL as a sandboxed iframe widget on the canvas.',
    run: (args) => {
      const editor = getEditor();
      if (!editor) {
        toast.error('Canvas not ready');
        return true;
      }
      const url = args.join(' ').trim();
      if (!url) {
        toast.error('Usage: /embed <url>');
        return true;
      }
      // Permit bare hosts (example.com) by prefixing https when the
      // user didn't supply a scheme. Reject anything that doesn't
      // parse as a URL after the fix-up.
      const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
      let parsed: URL;
      try {
        parsed = new URL(normalized);
      } catch {
        toast.error('Not a valid URL', { description: url });
        return true;
      }
      const tplId = useTemplateStore.getState().activeTemplateId;
      const id = crypto.randomUUID();
      try {
        applyToolDirective(
          editor,
          {
            type: 'place',
            id,
            kind: 'web-embed',
            role: 'primary',
            payload: { title: parsed.host, url: normalized },
          },
          tplId,
        );
        toast(`Embedded ${parsed.host}`);
      } catch (e) {
        toast.error('Could not embed', {
          description: e instanceof Error ? e.message : String(e),
        });
      }
      return true;
    },
  },
  {
    name: 'export-png',
    description: 'Download the current canvas as a PNG.',
    run: () => {
      const editor = getEditor();
      if (!editor) {
        toast.error('Canvas not ready');
        return true;
      }
      exportCanvasAsPng(editor)
        .then((ok) => {
          if (!ok) toast('Canvas is empty — nothing to export');
          else toast('Saved opencanvas.png');
        })
        .catch((e) => {
          toast.error('Export failed', { description: String(e) });
        });
      return true;
    },
  },
  {
    name: 'export-md',
    description: 'Download the current canvas as a Markdown file.',
    run: () => {
      const editor = getEditor();
      if (!editor) {
        toast.error('Canvas not ready');
        return true;
      }
      const md = exportCanvasAsMarkdown(editor);
      downloadText(md, 'opencanvas.md');
      toast('Saved opencanvas.md');
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

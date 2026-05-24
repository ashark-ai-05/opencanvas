/**
 * First-visit canvas seeding.
 *
 * The empty-canvas-paralysis problem: a brand new visitor lands on a
 * blank canvas + an overlay hint. They have no spatial signal for
 * what "widgets on a canvas" actually looks like. Time-to-first-wow
 * is 30+ seconds (type a prompt → wait for LLM → see a render).
 *
 * Fix: drop 3 sample widgets on the canvas at first ever visit so the
 * second they load the URL they see what the product does. The widgets
 * are real OpenCanvas widgets — fully draggable, editable, deletable —
 * not screenshots. Once seeded we set `opencanvas:welcome-seeded:v1`
 * in localStorage so we never repeat.
 *
 * Safety:
 *   - Only fires when the canvas is genuinely empty (no shapes at all).
 *   - Skips when the localStorage flag is already set (return visitor).
 *   - Skips silently if anything goes wrong — first impression should
 *     never be a JS error.
 */
import type { Editor } from 'tldraw';
import { applyToolDirective } from '../canvas/dispatcher';
import type { ToolDirective } from '../../../src/agent/types';

const FLAG_KEY = 'opencanvas:welcome-seeded:v1';

interface SeedWidget {
  kind: ToolDirective extends { type: 'place'; kind: infer K } ? K : never;
  role: 'primary' | 'detail' | 'related';
  title: string;
  payload: Record<string, unknown>;
}

/**
 * The three sample widgets dropped on a fresh canvas. Picked to
 * showcase variety: a friendly intro card, a structured list, and
 * a callout sticky. All deletable in one click.
 */
const SEEDS: SeedWidget[] = [
  {
    kind: 'markdown' as const,
    role: 'primary',
    title: 'Welcome to OpenCanvas',
    payload: {
      title: '👋 Welcome',
      body:
        "**Ask anything in the chat** — the agent places widgets here as it answers.\n\n" +
        "Try one of the prompts in the chat panel, or just type:\n\n" +
        "- *\"Build a Pomodoro timer\"*\n" +
        "- *\"Show me a flowchart for OAuth\"*\n" +
        "- *\"Compare React vs Vue in a table\"*\n\n" +
        'Use the **gear icon** in the header to bring your own model + API key.',
    },
  },
  {
    kind: 'tasks' as const,
    role: 'detail',
    title: 'Try these next',
    payload: {
      title: 'Try these',
      items: [
        { text: 'Ask the agent to build a chart', done: false },
        { text: 'Place a mermaid diagram', done: false },
        { text: 'Drag this widget anywhere', done: false },
        { text: 'Delete me when you start chatting', done: false },
      ],
    },
  },
  {
    kind: 'sticky-note' as const,
    role: 'related',
    title: 'Sample sticky',
    payload: {
      body:
        "Every widget is real — drag, edit, delete. " +
        'The agent learns your patterns and saves reusable templates over time.',
      colour: 'violet',
    },
  },
];

/**
 * Drop sample widgets on the canvas if and only if this is a fresh
 * first visit AND the canvas is empty. Idempotent across page
 * reloads via the localStorage flag — second-visit users see their
 * own work, not seeds.
 *
 * Errors are swallowed; this is a UX nicety, not a critical path.
 */
export function seedWelcomeWidgetsIfFirstVisit(
  editor: Editor,
  templateId: string,
): void {
  try {
    // Already seeded for this browser → no-op.
    if (typeof localStorage !== 'undefined' && localStorage.getItem(FLAG_KEY)) {
      return;
    }

    // Canvas isn't empty (user came from a saved snapshot, or another
    // process already placed widgets) → respect their state.
    const existingShapes = editor.getCurrentPageShapes();
    if (existingShapes.length > 0) {
      // Still set the flag — they're past the empty-canvas-paralysis
      // moment regardless of where the shapes came from.
      try {
        localStorage.setItem(FLAG_KEY, '1');
      } catch {
        /* private browsing / disabled storage — ignore */
      }
      return;
    }

    // Build place directives and apply via the existing dispatcher.
    // Using applyToolDirective ensures the welcome widgets behave
    // exactly like agent-placed widgets — same shape types, same
    // role-driven slot resolution, same metadata.
    for (const seed of SEEDS) {
      const directive = {
        type: 'place' as const,
        id: crypto.randomUUID(),
        kind: seed.kind,
        role: seed.role,
        payload: seed.payload,
      } as ToolDirective;
      try {
        applyToolDirective(editor, directive, templateId);
      } catch (e) {
        // One widget failing shouldn't block the rest.
        console.warn('[welcome-widgets] failed to place', seed.kind, e);
      }
    }

    try {
      localStorage.setItem(FLAG_KEY, '1');
    } catch {
      /* ignore */
    }
  } catch (e) {
    // First impression must never be a JS error.
    console.warn('[welcome-widgets] seed failed:', e);
  }
}

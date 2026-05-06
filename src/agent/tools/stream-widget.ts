import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { ROLES, type WidgetKind, type Role } from '../types.js';
import type { WithArgs } from './_shared.js';
import type { WidgetStreamBus } from '../widget-stream-bus.js';

/**
 * stream_widget — open a streaming-content widget on the canvas.
 *
 * Unlike `place_widget` (one-shot), this tool returns immediately with a
 * widget id, then content arrives async via the WidgetStreamBus → SSE
 * `data-widget-stream-*` parts.
 *
 * V1 supports `markdown-stream` mode: the tool drives a hard-coded
 * markdown block (the agent provides the prose). The actual prose comes
 * from the agent's `text` arg — split into paragraphs, emitted as
 * append-text ops with a small inter-paragraph delay so the client
 * sees the text grow visibly. This is enough to validate the wire
 * protocol end-to-end before we wire LLM-driven generation.
 *
 * Future modes (table-stream, kv-stream) will accept a payload-pull
 * intent + drive the bus from server-side searches/LLM calls. They
 * reuse the same id + bus surface; only the tool's body changes.
 */

const inputShape = {
  mode: z
    .enum(['markdown-stream'])
    .default('markdown-stream')
    .describe(
      'streaming driver to use. v1: markdown-stream (prose). more modes will land for tables/kv.',
    ),
  role: z.enum(ROLES).describe('logical placement role'),
  title: z.string().describe('card title'),
  subtitle: z.string().optional().describe('optional subtitle / source attribution'),
  text: z
    .string()
    .describe(
      'full markdown content to stream into the widget. the tool splits it on blank lines and ' +
        'emits paragraphs in order. include trailing newline if you want a clean stream-end.',
    ),
  granularity: z
    .enum(['paragraph', 'sentence'])
    .default('paragraph')
    .describe(
      'how aggressively to chunk. paragraph (default) reads best for prose; sentence for code/data.',
    ),
};

type Args = {
  mode?: 'markdown-stream';
  role: Role;
  title: string;
  subtitle?: string;
  text: string;
  granularity?: 'paragraph' | 'sentence';
};

type StreamWidgetToolDef = WithArgs<typeof inputShape, Args>;

/**
 * Build the tool. Receives the per-turn bus from chat.ts via
 * AgentToolDeps. If the bus is null (test harnesses, providers that
 * don't wire streaming), the tool falls back to a one-shot place
 * directive containing the full text — the user still sees the
 * widget, just without the streaming visual.
 */
export function streamWidgetTool(
  bus: WidgetStreamBus | null,
): StreamWidgetToolDef {
  const def = tool(
    'stream_widget',
    `Place a widget whose content STREAMS in over time, instead of arriving in one shot.

When to use this instead of place_widget:
  - long markdown prose (the user sees it grow rather than waiting)
  - generated content (LLM continuations, KB walks)
  - anything > ~300 chars of body text

The widget is placed immediately with an empty scaffold; the body
streams in via the same chat connection. The tool returns once
streaming is COMPLETE (i.e. it awaits the full stream), so if you call
this twice the second call waits for the first.

Modes (v1):
  - markdown-stream — given \`text\`, splits on \`granularity\` and
    emits paragraphs/sentences as append-text ops. The user sees the
    text grow paragraph-by-paragraph in a generic widget.

Args:
  - role: same as place_widget — logical placement role.
  - title: card title.
  - subtitle?: optional sub-text below title.
  - text: full markdown content (the tool chunks this).
  - granularity: 'paragraph' (default, prose) | 'sentence' (code/data).`,
    inputShape,
    async (args) => {
      const id = randomUUID();
      const widgetKind: WidgetKind = 'generic';
      const role = args.role;
      const granularity = args.granularity ?? 'paragraph';

      // Scaffold: a generic widget with one empty markdown block plus
      // optional subtitle. The block index 0 is the streaming target.
      const scaffold: Record<string, unknown> = {
        title: args.title,
        ...(args.subtitle ? { subtitle: args.subtitle } : {}),
        blocks: [{ type: 'markdown', content: '' }],
      };

      // No bus → fall back to one-shot place. The agent doesn't see a
      // failure; the user gets a fully-formed widget without streaming.
      if (!bus) {
        const fallbackPayload: Record<string, unknown> = {
          ...scaffold,
          blocks: [{ type: 'markdown', content: args.text }],
        };
        const directive = {
          type: 'place' as const,
          id,
          kind: widgetKind,
          role,
          payload: fallbackPayload,
        };
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, id, directive }) },
          ],
        };
      }

      bus.start({ id, widgetKind, role, scaffold });

      try {
        const chunks = chunkMarkdown(args.text, granularity);
        for (const chunk of chunks) {
          if (bus.isCancelled(id)) {
            bus.end(id, false, 'cancelled by user');
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({ ok: false, id, cancelled: true }),
                },
              ],
            };
          }
          bus.op(id, { kind: 'append-text', blockIndex: 0, text: chunk });
          // Tiny breath so the client gets a chance to paint between
          // chunks. 35ms/chunk = ~28 chunks/sec — comfortable for the
          // eye, well under the rAF flush rate.
          await sleep(35);
        }
        bus.end(id, true);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        bus.end(id, false, message);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ ok: false, id, error: message }),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ ok: true, id, streamed: true }) },
        ],
      };
    },
  );
  return def as unknown as StreamWidgetToolDef;
}

/**
 * Split markdown into chunks. Paragraphs (double-newline boundaries)
 * for prose; sentences (terminator-followed-by-space) for denser
 * content. Each chunk keeps its trailing whitespace so concatenation
 * reproduces the original.
 */
export function chunkMarkdown(
  text: string,
  granularity: 'paragraph' | 'sentence',
): string[] {
  if (text.length === 0) return [];
  if (granularity === 'paragraph') {
    // Split on blank-line boundaries. Re-attach the boundary to the
    // PRECEDING chunk so concatenation is loss-free.
    const parts = text.split(/(\n\s*\n)/);
    const out: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
      const body = parts[i] ?? '';
      const sep = parts[i + 1] ?? '';
      if (body.length === 0 && sep.length === 0) continue;
      out.push(body + sep);
    }
    return out.length > 0 ? out : [text];
  }
  // Sentence: split on . ! ? followed by whitespace; keep the terminator + ws.
  const parts = text.split(/([.!?]+\s+)/);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? '';
    const sep = parts[i + 1] ?? '';
    if (body.length === 0 && sep.length === 0) continue;
    out.push(body + sep);
  }
  return out.length > 0 ? out : [text];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

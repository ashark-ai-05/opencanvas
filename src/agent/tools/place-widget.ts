import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { WIDGET_KINDS, ROLES } from '../types.js';
import { validatePayloadForKind } from '../payloads.js';
import type { WithArgs } from './_shared.js';

const inputShape = {
  kind: z.enum(WIDGET_KINDS).describe('widget kind'),
  role: z.enum(ROLES).describe('logical placement role'),
  payload: z
    .record(z.string(), z.unknown())
    .describe('content payload (schema depends on kind)'),
};

type Args = {
  kind: (typeof WIDGET_KINDS)[number];
  role: (typeof ROLES)[number];
  payload: Record<string, unknown>;
};

type PlaceWidgetToolDef = WithArgs<typeof inputShape, Args>;

export function placeWidgetTool(): PlaceWidgetToolDef {
  const def = tool(
    'place_widget',
    `Place a widget on the canvas at the role's slot in the active template.

Payload schema per kind (use these field names exactly):
  - markdown:        { title: string, body: string }
  - code-block:      { title: string, language: string, code: string, source?: string }
  - ticket:          { ticketId: string, title: string, status: string, assignee?: string, priority?: string }
  - web-embed:       { title: string, url: string, snippet?: string }
  - key-value-card:  { title: string, fields: [{ key: string, value: string }] }`,
    inputShape,
    async (args) => {
      try {
        const validated = validatePayloadForKind(args.kind, args.payload);
        const id = randomUUID();
        const directive = {
          type: 'place' as const,
          id,
          kind: args.kind,
          role: args.role,
          payload: validated,
        };
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, id, directive }) },
          ],
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          content: [
            { type: 'text' as const, text: `Invalid payload for kind=${args.kind}: ${message}` },
          ],
          isError: true,
        };
      }
    },
  );
  return def as unknown as PlaceWidgetToolDef;
}

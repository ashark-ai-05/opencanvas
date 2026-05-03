import { z } from 'zod';
import type { WidgetKind } from './types.js';

export const MarkdownPayload = z.object({
  title: z.string(),
  body: z.string(),
});

export const CodeBlockPayload = z.object({
  title: z.string(),
  language: z.string(),
  code: z.string(),
  source: z.string().optional(),
});

export const TicketPayload = z.object({
  ticketId: z.string(),
  title: z.string(),
  status: z.string(),
  assignee: z.string().optional(),
  priority: z.string().optional(),
});

export const WebEmbedPayload = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional(),
});

export const KeyValueCardPayload = z.object({
  title: z.string(),
  fields: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
});

const PAYLOAD_SCHEMAS = {
  markdown: MarkdownPayload,
  'code-block': CodeBlockPayload,
  ticket: TicketPayload,
  'web-embed': WebEmbedPayload,
  'key-value-card': KeyValueCardPayload,
} as const;

/**
 * Parse `payload` against the schema for `kind`.
 * Throws ZodError on schema mismatch and Error('unknown widget kind') on
 * an unrecognised kind. Used by the place_widget handler.
 */
export function validatePayloadForKind(
  kind: WidgetKind,
  payload: unknown,
): Record<string, unknown> {
  const schema = PAYLOAD_SCHEMAS[kind];
  if (!schema) throw new Error(`unknown widget kind: ${kind}`);
  return schema.parse(payload);
}

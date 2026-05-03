import { z } from 'zod';
import type { WidgetKind } from './types.js';

export const MarkdownPayload = z.object({
  title: z.string(),
  body: z.string(),
  source: z.string().optional(),
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
  description: z.string().optional(),
  source: z.string().optional(),
});

export const WebEmbedPayload = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional(),
  source: z.string().optional(),
});

export const KeyValueCardPayload = z.object({
  title: z.string(),
  fields: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
    }),
  ),
  source: z.string().optional(),
});

/**
 * Tabular data: N columns × M rows. Columns can be tagged with an optional
 * align hint and `mono` flag for monospace cell rendering (ids, hashes).
 * Rows are arrays of strings — same length as `columns`.
 */
export const TablePayload = z.object({
  title: z.string(),
  columns: z.array(
    z.object({
      key: z.string(),
      label: z.string().optional(),
      align: z.enum(['left', 'right', 'center']).optional(),
      mono: z.boolean().optional(),
    }),
  ).min(1),
  rows: z.array(z.array(z.string())),
  source: z.string().optional(),
});

/**
 * Chronological events. Each event has a timestamp (ISO 8601 or any
 * string the model picks — we don't parse), a label, optional body and
 * optional kind tag for visual styling (commit / deploy / incident / note).
 */
export const TimelinePayload = z.object({
  title: z.string(),
  events: z.array(
    z.object({
      timestamp: z.string(),
      label: z.string(),
      body: z.string().optional(),
      kind: z.enum(['commit', 'deploy', 'incident', 'note', 'release']).optional(),
    }),
  ).min(1),
  source: z.string().optional(),
});

/**
 * Hierarchical filesystem-like tree. Nodes are recursive: file leaves
 * have no children; directories have a children array. `meta` is a free
 * string slot for size, modtime, file count, etc.
 */
type FileNode = {
  name: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  meta?: string;
};
const FileNodeSchema: z.ZodType<FileNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.enum(['file', 'directory']),
    children: z.array(FileNodeSchema).optional(),
    meta: z.string().optional(),
  }),
);
export const FileTreePayload = z.object({
  title: z.string(),
  root: FileNodeSchema,
  source: z.string().optional(),
});

const PAYLOAD_SCHEMAS = {
  markdown: MarkdownPayload,
  'code-block': CodeBlockPayload,
  ticket: TicketPayload,
  'web-embed': WebEmbedPayload,
  'key-value-card': KeyValueCardPayload,
  table: TablePayload,
  timeline: TimelinePayload,
  'file-tree': FileTreePayload,
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

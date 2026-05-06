/**
 * Zod payload schemas for every widget kind. Each schema accepts an optional
 * `source: string` AND an optional `sources` array of clickable footer pills:
 *
 *   sources?: Array<string | { url: string; label?: string }>
 *
 * `source` is the canonical origin (one chunk source-id, one URL); `sources`
 * is for multi-attribution (KB hit + JIRA URL + Confluence page).
 *
 * Spec: REPLICATION-PROMPT.md §12.
 */
import { z } from 'zod';
import type { WidgetKind } from './types.js';
import { COMPOSITE_SECTION_KINDS } from './types.js';

const SourcesSchema = z
  .array(
    z.union([
      z.string().url(),
      z.object({
        url: z.string().url(),
        label: z.string().optional(),
      }),
    ]),
  )
  .optional();

/** Common mixin: every widget supports source + sources for attribution. */
const baseAttribution = {
  source: z.string().optional(),
  sources: SourcesSchema,
};

export const MarkdownPayload = z.object({
  title: z.string(),
  body: z.string(),
  ...baseAttribution,
});

export const CodeBlockPayload = z.object({
  title: z.string(),
  language: z.string(),
  code: z.string(),
  ...baseAttribution,
});

export const TicketPayload = z.object({
  ticketId: z.string(),
  title: z.string(),
  status: z.string(),
  assignee: z.string().optional(),
  priority: z.string().optional(),
  description: z.string().optional(),
  ...baseAttribution,
});

export const WebEmbedPayload = z.object({
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().optional(),
  ...baseAttribution,
});

export const KeyValueCardPayload = z.object({
  title: z.string(),
  fields: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      url: z.string().url().optional(),
    }),
  ),
  ...baseAttribution,
});

/**
 * Tabular data: N columns × M rows. Columns can be tagged with an optional
 * `align` hint and a `mono` flag for monospace cell rendering (ids, hashes).
 * Rows are arrays of strings — same length as `columns`.
 *
 * `rowLinks` (optional) is parallel to `rows`: each entry is a URL the row
 * links to, or null for non-clickable rows. Lets the model emit a list of
 * search hits as a clickable table without wrapping each row in markdown.
 */
export const TablePayload = z.object({
  title: z.string(),
  columns: z
    .array(
      z.object({
        key: z.string(),
        label: z.string().optional(),
        align: z.enum(['left', 'right', 'center']).optional(),
        mono: z.boolean().optional(),
      }),
    )
    .min(1),
  rows: z.array(z.array(z.string())),
  rowLinks: z.array(z.union([z.string().url(), z.null()])).optional(),
  ...baseAttribution,
});

/**
 * Chronological events. `timestamp` is free-form (ISO 8601 by convention,
 * but anything string-shaped works — the renderer just shows it). `kind`
 * is also free-form: the renderer styles the well-known values
 * (commit/deploy/incident/note/release) and defaults the rest to `note`.
 */
export const TimelinePayload = z.object({
  title: z.string(),
  events: z
    .array(
      z.object({
        timestamp: z.string(),
        label: z.string(),
        body: z.string().optional(),
        kind: z.string().optional(),
        url: z.string().url().optional(),
      }),
    )
    .min(1),
  ...baseAttribution,
});

/**
 * Hierarchical filesystem-like tree. Nodes are recursive: file leaves
 * have no children; directories have a children array. `meta` is a free
 * string slot for size, modtime, file count, etc. `url` makes any node
 * clickable (e.g. link to a file viewer).
 */
type FileNode = {
  name: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  meta?: string;
  url?: string;
};
const FileNodeSchema: z.ZodType<FileNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    type: z.enum(['file', 'directory']),
    children: z.array(FileNodeSchema).optional(),
    meta: z.string().optional(),
    url: z.string().url().optional(),
  }),
);
export const FileTreePayload = z.object({
  title: z.string(),
  root: FileNodeSchema,
  ...baseAttribution,
});

export const TasksPayload = z.object({
  title: z.string(),
  items: z
    .array(
      z.object({
        id: z.string().optional(),
        text: z.string(),
        done: z.boolean().optional(),
        assignee: z.string().optional(),
        due: z.string().optional(),
        priority: z.string().optional(),
        url: z.string().url().optional(),
      }),
    )
    .min(1),
  ...baseAttribution,
});

export const KanbanPayload = z.object({
  title: z.string(),
  columns: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string(),
        colour: z
          .enum(['neutral', 'blue', 'amber', 'green', 'rose', 'violet'])
          .optional(),
        cards: z.array(
          z.object({
            id: z.string().optional(),
            title: z.string(),
            body: z.string().optional(),
            assignee: z.string().optional(),
            priority: z.string().optional(),
            tag: z.string().optional(),
            url: z.string().url().optional(),
          }),
        ),
      }),
    )
    .min(1),
  ...baseAttribution,
});

/**
 * Generic widget — universal fallback that composes typed blocks. The agent
 * uses this when no specialized kind fits, OR the dispatcher synthesizes one
 * via the auto-classifier when a payload fails its specialized schema.
 *
 * Block union (extensible — add types here, then a renderer in
 * app/src/canvas/shapes/generic.tsx):
 *   - markdown : { content }
 *   - table    : { columns, rows, rowLinks? }     // mirrors TablePayload
 *   - kv       : { fields: [{ key, value, url? }]} // mirrors KeyValueCardPayload
 *   - embed    : { url, height? }                  // iframe
 *   - json     : { data }                          // pretty-printed fallback
 *
 * The classifier (src/agent/classifier.ts) will only ever emit these five
 * starter blocks. Adding a new block type is a 3-step change: schema below,
 * renderer in generic.tsx, optional classifier heuristic.
 */
const MarkdownBlock = z.object({
  type: z.literal('markdown'),
  content: z.string(),
});
const TableBlock = z.object({
  type: z.literal('table'),
  columns: z.array(
    z.object({
      key: z.string(),
      label: z.string().optional(),
      align: z.enum(['left', 'right', 'center']).optional(),
      mono: z.boolean().optional(),
    }),
  ),
  rows: z.array(z.array(z.string())),
  rowLinks: z.array(z.union([z.string().url(), z.null()])).optional(),
});
const KVBlock = z.object({
  type: z.literal('kv'),
  fields: z.array(
    z.object({
      key: z.string(),
      value: z.string(),
      url: z.string().url().optional(),
    }),
  ),
});
const EmbedBlock = z.object({
  type: z.literal('embed'),
  url: z.string().url(),
  height: z.number().int().positive().optional(),
});
const JsonBlock = z.object({
  type: z.literal('json'),
  data: z.unknown(),
});
const GenericBlock = z.discriminatedUnion('type', [
  MarkdownBlock,
  TableBlock,
  KVBlock,
  EmbedBlock,
  JsonBlock,
]);
export type GenericBlockT = z.infer<typeof GenericBlock>;

export const GenericPayload = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  blocks: z.array(GenericBlock).min(1),
  ...baseAttribution,
});

/**
 * Time widget — single shape that handles four live-clock modes:
 *   - clock     : current wall-clock time in `tz` (default browser local).
 *   - timer     : counts DOWN from `durationSec` since `startedAt`.
 *   - stopwatch : counts UP from `startedAt`.
 *   - pomodoro  : auto-cycles between work and break phases; tracks
 *                 completed sessions; long-break every `longBreakEvery`.
 *
 * The shape ticks on its own (setInterval inside the component); the
 * agent only places the initial state. Subsequent state changes
 * (play/pause/reset) come from the user clicking the shape's buttons
 * and write directly via editor.updateShape — no agent round-trip.
 *
 * Time bookkeeping:
 *   - startedAt  : epoch ms of the most recent run-start (NOT the
 *                  original placement). Pausing freezes the elapsed
 *                  amount into elapsedAtPause and clears startedAt.
 *   - elapsedAtPause : running total before the current run started,
 *                      so a pause/resume cycle is loss-free.
 *   - paused     : when true, render elapsedAtPause directly; the
 *                  shape never advances.
 *
 * Field rationale: `tz` and `format` are clock-only. `durationSec` is
 * timer-only. `pomodoro` carries pomodoro-only config + state. The
 * runtime tldraw validator allows any optional combination — the
 * renderer reads only what its mode needs.
 */
export const TimePayload = z.object({
  mode: z.enum(['clock', 'timer', 'stopwatch', 'pomodoro']),
  label: z.string().optional(),
  /** IANA tz name for clock mode. Browser local when omitted. */
  tz: z.string().optional(),
  /** Clock display format. */
  format: z.enum(['12h', '24h']).optional(),
  /** Timer total duration. Required for timer mode. */
  durationSec: z.number().int().nonnegative().optional(),
  /** Epoch ms when the current run started. */
  startedAt: z.number().int().nonnegative().optional(),
  /** Accumulated elapsed (sec) before the current run started. */
  elapsedAtPause: z.number().nonnegative().optional(),
  /** Pause flag — true freezes the display at elapsedAtPause. */
  paused: z.boolean().optional(),
  /** Pomodoro config + state. Bundled so an MCP can drop a complete preset. */
  pomodoro: z
    .object({
      workSec: z.number().int().positive(),
      breakSec: z.number().int().positive(),
      longBreakSec: z.number().int().positive().optional(),
      /** Take a long break every Nth completed work session. */
      longBreakEvery: z.number().int().positive().optional(),
      /** Completed work sessions so far. */
      sessions: z.number().int().nonnegative().optional(),
      /** Current phase. Defaults to 'work' on placement. */
      phase: z.enum(['work', 'break', 'longBreak']).optional(),
    })
    .optional(),
  ...baseAttribution,
});

export const StickyNotePayload = z.object({
  body: z.string(),
  author: z.string().optional(),
  colour: z
    .enum(['yellow', 'pink', 'blue', 'green', 'violet', 'orange'])
    .optional(),
  ...baseAttribution,
});

/**
 * Composite: ONE card with multiple typed sections. Each section's
 * `kind` is one of the non-composite kinds; its `payload` is validated
 * against that kind's own schema by `superRefine`. Composite cannot nest
 * composite — the section-kind enum excludes 'composite'.
 *
 * Spec: §12 — for one entity many facets (a JIRA ticket header + details
 * + summary + rule), prefer ONE composite over 3 separate widgets.
 */
export const CompositePayload = z
  .object({
    title: z.string(),
    sections: z
      .array(
        z.object({
          heading: z.string().optional(),
          kind: z.enum(
            COMPOSITE_SECTION_KINDS as unknown as readonly [
              Exclude<WidgetKind, 'composite'>,
              ...Array<Exclude<WidgetKind, 'composite'>>,
            ],
          ),
          payload: z.record(z.string(), z.unknown()),
        }),
      )
      .min(1),
    ...baseAttribution,
  })
  .superRefine((value, ctx) => {
    value.sections.forEach((section, i) => {
      const schema = PAYLOAD_SCHEMAS[section.kind];
      if (!schema) return;
      const result = schema.safeParse(section.payload);
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `composite.sections[${i}] (${section.kind}): ${issue.message}`,
            path: ['sections', i, 'payload', ...issue.path],
          });
        }
      }
    });
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
  composite: CompositePayload,
  tasks: TasksPayload,
  kanban: KanbanPayload,
  'sticky-note': StickyNotePayload,
  generic: GenericPayload,
  time: TimePayload,
} as const satisfies Record<WidgetKind, z.ZodTypeAny>;

/** Re-export for the auto-classifier (which needs to know which kinds exist
 *  but lives outside this file). */
export const PAYLOAD_SCHEMAS_BY_KIND = PAYLOAD_SCHEMAS;

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
  return schema.parse(payload) as Record<string, unknown>;
}

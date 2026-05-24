import { z } from 'zod';
import { tool as claudeTool } from '@anthropic-ai/claude-agent-sdk';
import { tool } from 'ai';
import type { OpenCanvasToolCtx, WithArgs } from './_shared.js';
import type { CanvasSnapshot } from '../canvas-snapshot.js';
import {
  validatePayloadForKind,
  CompositePayload,
} from '../payloads.js';
import { COMPOSITE_SECTION_KINDS, type WidgetKind } from '../types.js';

/**
 * update_widget — replace a widget's payload OR append composite sections.
 *
 * Two mutually-meaningful modes:
 *   - `payload`: replace the entire payload (e.g. swap a markdown body,
 *     change a ticket status). Validated against the widget's stored kind.
 *   - `appendSections`: composite-only — push new sections onto the
 *     existing card. Each section's payload is validated against its
 *     own kind's schema before any mutation directive is emitted.
 *
 * The handler looks up the target widget in `getSnapshot()` so it can
 * (a) error helpfully when the id is unknown, and (b) for composite
 * payload-replacement: reject append/replace mismatches.
 */

const SectionSchema = z.object({
  heading: z.string().optional(),
  kind: z.enum(
    COMPOSITE_SECTION_KINDS as unknown as readonly [
      Exclude<WidgetKind, 'composite'>,
      ...Array<Exclude<WidgetKind, 'composite'>>,
    ],
  ),
  payload: z.record(z.string(), z.unknown()),
});

const inputShape = {
  id: z.string().describe('id of an existing widget on the canvas'),
  payload: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "replace the widget's entire payload (validated against the widget's kind). Mutually exclusive with appendSections.",
    ),
  appendSections: z
    .array(SectionSchema)
    .optional()
    .describe(
      'composite-only: append these sections to the existing composite. Each section is validated against its own kind.',
    ),
};

type UpdateArgs = {
  id: string;
  payload?: Record<string, unknown>;
  appendSections?: z.infer<typeof SectionSchema>[];
};

const TOOL_DESCRIPTION = `Update an existing widget on the canvas in place. Use this for follow-up turns ("show recent comments on that ticket", "is it actually done?", "swap the body for the latest summary") instead of placing a duplicate widget.

Pick exactly one of:
  - payload: replace the whole payload. Validated against the widget's stored kind.
  - appendSections: composite-only. Push new { heading?, kind, payload } sections onto the existing card.`;

type UpdateResult =
  | { ok: true; directive: Record<string, unknown> }
  | { ok: false; error: string };

/** Shared body — both v1 and v2 builders close over this. */
function executeUpdateWidget(
  getSnapshot: () => CanvasSnapshot,
  args: UpdateArgs,
): UpdateResult {
  const snapshot = getSnapshot();
  const target = snapshot.widgets.find((w) => w.id === args.id);
  if (!target) {
    return {
      ok: false,
      error: `Unknown widget id: ${args.id}. Call read_canvas to see what's currently on the canvas.`,
    };
  }

  if (!args.payload && !args.appendSections) {
    return { ok: false, error: 'Either `payload` or `appendSections` is required.' };
  }
  if (args.payload && args.appendSections) {
    return {
      ok: false,
      error: '`payload` and `appendSections` are mutually exclusive — pick one.',
    };
  }

  try {
    if (args.appendSections) {
      if (target.kind !== 'composite') {
        return {
          ok: false,
          error: `appendSections is composite-only. Widget ${args.id} is kind=${target.kind}.`,
        };
      }
      // Validate each new section's payload against its own kind. Reuse
      // CompositePayload's superRefine indirectly by parsing a synthetic
      // composite that has only the new sections.
      const synthetic = {
        title: 'append-validation',
        sections: args.appendSections,
      };
      CompositePayload.parse(synthetic);

      const directive = {
        type: 'update' as const,
        id: args.id,
        appendSections: args.appendSections,
      };
      return { ok: true, directive };
    }

    // payload-replacement mode
    const validated = validatePayloadForKind(target.kind, args.payload!);
    const directive = {
      type: 'update' as const,
      id: args.id,
      payload: validated,
    };
    return { ok: true, directive };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: `Invalid update for widget ${args.id} (kind=${target.kind}): ${message}`,
    };
  }
}

// ─── v1 (Claude SDK) — kept intact during migration ────────────────────
type UpdateWidgetToolDef = WithArgs<typeof inputShape, UpdateArgs>;

export function updateWidgetTool(
  getSnapshot: () => CanvasSnapshot,
): UpdateWidgetToolDef {
  const def = claudeTool(
    'update_widget',
    TOOL_DESCRIPTION,
    inputShape,
    async (args) => {
      const out = executeUpdateWidget(getSnapshot, args);
      if (!out.ok) {
        return {
          content: [{ type: 'text' as const, text: out.error }],
          isError: true,
        };
      }
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(out) },
        ],
      };
    },
  );
  return def as unknown as UpdateWidgetToolDef;
}

// ─── v2 (AI SDK) — the future ──────────────────────────────────────────
const inputSchema = z.object(inputShape);

export const updateWidgetToolV2 = (ctx: OpenCanvasToolCtx) =>
  tool({
    description: TOOL_DESCRIPTION,
    inputSchema,
    execute: async (args) => executeUpdateWidget(ctx.getSnapshot, args),
  });

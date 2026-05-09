import { z } from 'zod';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import type { WidgetRegistry } from '../../backend/widget-registry.js';
import type { WithArgs } from './_shared.js';

const inputShape = {
  kind: z
    .string()
    .regex(/^[a-z][a-z0-9-]{2,30}$/)
    .describe(
      'Unique kind name. Lowercase letters, digits, hyphens. Must not collide with existing built-in kinds (markdown, code-block, table, chart, calendar, html, …) or already-registered plugin kinds. Pick a descriptive slug like "stock-ticker" or "weather-card".',
    ),
  label: z
    .string()
    .min(1)
    .max(40)
    .describe('Human-readable label shown in the card header.'),
  description: z
    .string()
    .min(20)
    .describe(
      'Model-facing description telling future agent calls when to use this widget and what props it accepts. Be specific about prop shapes: e.g. "Pass {symbol: string} for the ticker symbol." Include "Use this when…" guidance.',
    ),
  srcdoc: z
    .string()
    .min(50)
    .describe(
      'Full HTML document (or fragment with <script>) to render in a sandboxed iframe. Read props from window.opencanvas?.props on load and listen for "opencanvas:props" events for live updates. Body background should be transparent. Inter font, dark theme (#fafafa text). CDN scripts are allowed (e.g., Tailwind, D3, Chart.js).',
    ),
  default_size: z
    .object({
      w: z.number().int().min(120).max(1200),
      h: z.number().int().min(80).max(900),
    })
    .optional()
    .describe('Default placement size in pixels. Defaults to {w: 420, h: 280} if omitted.'),
};

type RegisterWidgetKindArgs = {
  kind: string;
  label: string;
  description: string;
  srcdoc: string;
  default_size?: { w: number; h: number };
};

type RegisterWidgetKindToolDef = WithArgs<typeof inputShape, RegisterWidgetKindArgs>;

/**
 * Agent tool: register_widget_kind
 *
 * Registers a new plugin widget kind at runtime so future `place_widget`
 * calls can use it with a small payload instead of resending the full HTML
 * template each time. The registered kind persists for the lifetime of the
 * backend process.
 *
 * Use for REPEAT patterns ("stock ticker", "weather card") where the user
 * will want multiple instances or re-renders with different props.
 * For one-shot novel renders, use the built-in `html` widget instead.
 */
export function registerWidgetKindTool(
  getRegistry: () => WidgetRegistry,
): RegisterWidgetKindToolDef {
  const def = tool(
    'register_widget_kind',
    'Register a new widget kind at runtime so future place_widget calls can use it with just a small payload (instead of resending the full HTML each time). Use for REPEAT patterns ("stock-ticker", "weather-card") where the user will want multiple instances. For one-shot novel renders, use the built-in `html` widget instead.\n\nThe registered widget renders in a sandboxed iframe (allow-scripts only). srcdoc must read props from `window.opencanvas?.props` on load + listen for "opencanvas:props" events for live updates. Returns the registered descriptor on success, or an error if the kind already exists.',
    inputShape,
    async (args) => {
      const registry = getRegistry();
      // Reject if kind already exists — avoid clobbering built-ins or other plugins.
      if (registry.get(args.kind)) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                ok: false,
                error: `Kind "${args.kind}" already exists. Pick a different name or use place_widget with the existing kind.`,
              }),
            },
          ],
          isError: true,
        };
      }
      const descriptor = {
        kind: args.kind,
        label: args.label,
        description: args.description,
        renderer: {
          type: 'iframe' as const,
          sandbox: 'allow-scripts',
          srcdoc: args.srcdoc,
          defaultSize: args.default_size ?? { w: 420, h: 280 },
        },
      };
      registry.register(descriptor);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              ok: true,
              descriptor: { kind: descriptor.kind, label: descriptor.label },
            }),
          },
        ],
      };
    },
  );
  return def as unknown as RegisterWidgetKindToolDef;
}

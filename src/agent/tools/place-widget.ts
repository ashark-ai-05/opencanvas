import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { WIDGET_KINDS, ROLES, type WidgetKind } from '../types.js';
import { validatePayloadForKind } from '../payloads.js';
import { classifyToGeneric } from '../classifier.js';
import type { WithArgs } from './_shared.js';

const inputShape = {
  /**
   * `kind` is intentionally `z.string()` (not z.enum) so the agent can
   * attempt unknown kinds — the tool gracefully auto-classifies them
   * into a `generic` widget instead of erroring. This also makes room
   * for future MCP-registered kinds without re-deploying.
   */
  kind: z
    .string()
    .describe(
      'widget kind — one of the registered kinds, or any string (unknown ' +
        "kinds auto-classify to 'generic' with typed blocks)",
    ),
  role: z.enum(ROLES).describe('logical placement role'),
  payload: z
    .record(z.string(), z.unknown())
    .describe('content payload (schema depends on kind)'),
};

type Args = {
  kind: string;
  role: (typeof ROLES)[number];
  payload: Record<string, unknown>;
};

type PlaceWidgetToolDef = WithArgs<typeof inputShape, Args>;

/**
 * Plugin descriptor surface used to enrich the tool's description at
 * session start. Matches the shape from src/backend/widget-registry's
 * PluginKindDescriptor — kept as a structural type here so this file
 * doesn't depend on the backend layer.
 */
export type PluginKindHint = {
  kind: string;
  label?: string;
  description?: string;
};

/**
 * Build the plugin section that gets appended to the tool's description.
 * Empty array → empty string (no section header). Each plugin gets one
 * line: kind, optional label, optional description.
 */
function pluginsSection(plugins: PluginKindHint[] | undefined): string {
  if (!plugins || plugins.length === 0) return '';
  const lines = plugins
    .slice()
    .sort((a, b) => a.kind.localeCompare(b.kind))
    .map((p) => {
      const desc = p.description ? ` — ${p.description}` : '';
      const label = p.label ? ` (${p.label})` : '';
      return `  - ${p.kind}${label}${desc}`;
    });
  return [
    '',
    'Plugin widget kinds (registered at runtime; pass `kind: "<name>"` and a free-form `payload` object — the plugin renders it inside a sandboxed iframe):',
    ...lines,
  ].join('\n');
}

export function placeWidgetTool(plugins?: PluginKindHint[]): PlaceWidgetToolDef {
  const def = tool(
    'place_widget',
    `Place a widget on the canvas at the role's slot in the active template.

Every payload accepts optional \`source\` (single canonical origin) AND \`sources\` (array of {url, label?} for multi-attribution).

Payload schema per kind (use these field names exactly):
  - markdown        { title, body }
  - code-block      { title, language, code }
  - ticket          { ticketId, title, status, assignee?, priority?, description? }
  - web-embed       { title, url, snippet? }
  - key-value-card  { title, fields: [{ key, value, url? }] }
  - table           { title, columns: [{ key, label?, align?: left|right|center, mono?: bool }], rows: string[][], rowLinks?: (url|null)[] }
  - timeline        { title, events: [{ timestamp, label, body?, kind?, url? }] }
  - file-tree       { title, root: { name, type: file|directory, children?, meta?, url? } }
  - tasks           { title, items: [{ id?, text, done?, assignee?, due?, priority?, url? }] }
  - kanban          { title, columns: [{ id?, name, colour?: neutral|blue|amber|green|rose|violet, cards: [{ id?, title, body?, assignee?, priority?, tag?, url? }] }] }
  - sticky-note     { body, author?, colour?: yellow|pink|blue|green|violet|orange }
  - composite       { title, sections: [{ heading?, kind: <any non-composite kind>, payload }] } — ONE card with multiple typed sections; cannot nest composite
  - generic         { title, subtitle?, blocks: [{ type: 'markdown'|'table'|'kv'|'embed'|'json', ... }] } — universal fallback. Use when no specialized kind fits; compose blocks like Notion sections.
  - time            { mode: 'clock'|'timer'|'stopwatch'|'pomodoro', label?, tz?, format?: '12h'|'24h', durationSec?, startedAt?, elapsedAtPause?, paused?, pomodoro?: { workSec, breakSec, longBreakSec?, longBreakEvery?, sessions?, phase?: 'work'|'break'|'longBreak' } } — live time widget that ticks on its own. Examples:
                      clock     — { mode: 'clock', tz: 'Asia/Tokyo', format: '24h', label: 'Tokyo' }
                      timer     — { mode: 'timer', durationSec: 1500, startedAt: <epoch ms>, label: '25-min focus' }   # autostarts
                      stopwatch — { mode: 'stopwatch', startedAt: <epoch ms> }                                          # autostarts
                      pomodoro  — { mode: 'pomodoro', startedAt: <epoch ms>, pomodoro: { workSec: 1500, breakSec: 300, longBreakSec: 900, longBreakEvery: 4 } }
                    Omit startedAt to place a paused widget the user starts manually.

Errors return as tool errors (isError=true) so you can correct + retry. Three failure modes: (a) BUILT-IN KIND with bad payload — the validation message tells you which fields are wrong; fix the payload + retry. (b) UNKNOWN KIND — pick an existing built-in or plugin kind, or call register_widget_kind first to define a new template, then retry. (c) Plugin kinds (e.g. \`html\`, \`chart\`, \`calendar\`) accept any \`payload\` object — no schema validation; the iframe srcdoc handles whatever you pass.${pluginsSection(plugins)}`,
    inputShape,
    async (args) => {
      const id = randomUUID();
      const knownKind = (WIDGET_KINDS as readonly string[]).includes(args.kind)
        ? (args.kind as WidgetKind)
        : null;
      const pluginKind = !knownKind && plugins?.some((p) => p.kind === args.kind)
        ? args.kind
        : null;

      // 1. Built-in kind path — strict payload validation.
      if (knownKind) {
        try {
          const validated = validatePayloadForKind(knownKind, args.payload);
          const directive = {
            type: 'place' as const,
            id,
            kind: knownKind,
            role: args.role,
            payload: validated,
          };
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify({ ok: true, id, directive }) },
            ],
          };
        } catch (e) {
          // Hard error so the agent retries with a corrected payload.
          // Previously this silently reformatted to `generic`, which the
          // agent treated as success — leaving stale placeholder widgets
          // accumulating on the canvas while the agent moved on without
          // recovering. The user sees junk widgets; agent thinks it
          // worked. The right behavior is: tell the agent it failed.
          const message = e instanceof Error ? e.message : String(e);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  ok: false,
                  error: `Invalid payload for kind '${knownKind}': ${message}. Fix the payload fields and retry, or use a different kind.`,
                }),
              },
            ],
            isError: true,
          };
        }
      }

      // 2. Plugin kind path — wrap as `kind: 'plugin'` directive that the
      // browser's PluginShape resolves via the registered iframe-srcdoc
      // descriptor. Plugins accept arbitrary `payload` objects (no
      // schema validation here); the srcdoc handles what it gets via
      // window.opencanvas.props.
      if (pluginKind) {
        const inner = (typeof args.payload === 'object' && args.payload !== null
          ? args.payload
          : {}) as Record<string, unknown>;
        const directive = {
          type: 'place' as const,
          id,
          kind: 'plugin' as const,
          role: args.role,
          payload: {
            pluginKind,
            props: inner,
            ...(typeof inner['title'] === 'string' ? { title: inner['title'] } : {}),
          },
        };
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ ok: true, id, directive }) },
          ],
        };
      }

      // 3. Truly unknown kind — hard error suggesting register_widget_kind
      // or one of the available built-in/plugin kinds. Same rationale as
      // (1): silent reformat to `generic` produces junk widgets that the
      // agent thinks succeeded.
      const builtins = (WIDGET_KINDS as readonly string[]).join(', ');
      const pluginNames = plugins?.length
        ? plugins.map((p) => p.kind).sort().join(', ')
        : '(none)';
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              ok: false,
              error: `Unknown widget kind '${args.kind}'. For a NOVEL one-shot render, use kind:'html' with payload:{html:'<full HTML>'}. For a REUSABLE template, call register_widget_kind first to define '${args.kind}' then retry place_widget. Or pick an existing built-in [${builtins}] or plugin [${pluginNames}].`,
            }),
          },
        ],
        isError: true,
      };
    },
  );
  return def as unknown as PlaceWidgetToolDef;
}

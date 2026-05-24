/**
 * Background "learn from this render" pass.
 *
 * After the agent uses the universal `html` plugin to render something
 * non-trivial, an extractor LLM call generalises that HTML into a
 * reusable `PluginKindDescriptor`:
 *
 *    Concrete render          → Reusable template
 *    ───────────────────         ────────────────────
 *    html with sin wave at      kind 'sine-wave',
 *    amplitude=50 hardcoded,    props {amplitude, freq, color},
 *    fixed indigo color, fixed  srcdoc reads them from
 *    frequency 0.05             window.opencanvas.props
 *
 * The generalised template is then registered via the same WidgetRegistry
 * the agent's `register_widget_kind` tool uses — which persists to disk
 * via the subscriber set up in BackendState (so next session can reuse
 * what this session built).
 *
 * Triggering: chat.ts onFinish detects a successful `place_widget` call
 * with `kind: 'html'` and a substantial html payload, and queues an
 * extraction (fire-and-forget — never blocks the response stream).
 *
 * Failure model: any extraction error is logged and dropped. The user
 * already got the visible html render; the template is a bonus. We never
 * surface extraction errors to the chat — they'd be noise.
 *
 * Cost: one ~1k-input/1k-output LLM call per html render. With Gemini
 * Flash Lite Latest that's <$0.0005 — cheap enough to fire on every
 * meaningful html render. To guard against pathological loops a process-
 * wide concurrency cap of 2 keeps the extractor from queueing forever.
 */
import { streamText } from 'ai';
import type { LanguageModel } from 'ai';
import type { WidgetRegistry, PluginKindDescriptor } from '../backend/widget-registry.js';
import type { ProviderOptionsRecord } from './model-resolver.js';

const MAX_CONCURRENT = 2;
let inFlight = 0;
const pending: Array<() => void> = [];

interface ExtractionInput {
  /** The full html the agent passed in payload.html. */
  html: string;
  /** The user's most recent message — context for inferring a useful name + description. */
  userMessage: string;
  /** Optional title from the original payload. */
  title?: string;
}

/**
 * Generalise a one-shot html render into a reusable template, register
 * it on the supplied registry, and return what was registered (or null
 * if extraction failed for any reason).
 *
 * Caller is responsible for deduplication — if a kind by the same name
 * already exists, registry.register() overwrites it (and the persistence
 * subscriber writes the new version to disk).
 */
export async function extractAndRegisterTemplate(
  input: ExtractionInput,
  model: LanguageModel,
  registry: WidgetRegistry,
  providerOptions?: ProviderOptionsRecord,
): Promise<PluginKindDescriptor | null> {
  if (input.html.length < 200) return null; // too small to template usefully

  // Concurrency gate. If the limit is hit, the caller's promise resolves
  // immediately to null — we'd rather drop the extraction than queue
  // unbounded work that gets stale.
  if (inFlight >= MAX_CONCURRENT) {
    return null;
  }
  inFlight++;
  try {
    return await runExtraction(input, model, registry, providerOptions);
  } finally {
    inFlight--;
    const next = pending.shift();
    if (next) next();
  }
}

async function runExtraction(
  input: ExtractionInput,
  model: LanguageModel,
  registry: WidgetRegistry,
  providerOptions?: ProviderOptionsRecord,
): Promise<PluginKindDescriptor | null> {
  const system = EXTRACTOR_SYSTEM_PROMPT;
  const userText = buildExtractorPrompt(input);

  let outputText = '';
  try {
    const result = streamText({
      model,
      system,
      messages: [{ role: 'user', content: userText }],
      // No tools — extractor returns plain JSON in its text reply.
      // Short cap; we want JSON, not prose.
      maxOutputTokens: 4000,
      ...(providerOptions ? { providerOptions } : {}),
    });
    for await (const chunk of result.fullStream) {
      if (chunk.type === 'text-delta') {
        outputText += chunk.text;
      }
    }
  } catch (e) {
    console.warn(
      '[template-extractor] LLM call failed:',
      e instanceof Error ? e.message : e,
    );
    return null;
  }

  const parsed = parseExtractorOutput(outputText);
  if (!parsed) {
    console.warn('[template-extractor] could not parse LLM output as a template');
    return null;
  }
  // Don't overwrite registry built-ins. If the LLM picks `kind: 'html'`,
  // we'd nuke the universal escape hatch. Reject obvious collisions.
  if (RESERVED_KINDS.has(parsed.kind)) {
    console.warn(`[template-extractor] LLM picked a reserved kind '${parsed.kind}' — dropping`);
    return null;
  }
  registry.register(parsed);
  console.log(`[template-extractor] auto-registered '${parsed.kind}'`);
  return parsed;
}

const RESERVED_KINDS = new Set([
  // Built-in plugins we don't want LLM-overwritten.
  'html',
  'chart',
  'mermaid',
  'calendar',
]);

const EXTRACTOR_SYSTEM_PROMPT = `You are a code refactoring assistant for OpenCanvas. Your job: take a one-shot HTML render the agent just produced and generalise it into a reusable template.

Output ONLY a JSON object matching this shape (no prose, no markdown fences):

  {
    "kind": "<lowercase-kebab-case slug, 3-30 chars, descriptive>",
    "label": "<Human-readable title, 1-40 chars>",
    "description": "<Why an agent would use this template + what props it accepts. 60-300 chars.>",
    "srcdoc": "<the generalised HTML, with hardcoded data swapped for placeholders read from window.opencanvas.props>",
    "default_size": { "w": <120-1200>, "h": <80-900> }
  }

Rules:
- Identify the VARIABLE bits in the HTML — colors, numeric parameters, text content, data arrays — and turn them into props the srcdoc reads from \`window.opencanvas.props\`. Use sensible defaults if a prop is missing.
- The srcdoc must read props on load AND listen for \`opencanvas:props\` events on \`document\` (the plugin shim dispatches there) for live updates.
- Keep ALL <script> blocks intact; just parametrise the variable values.
- The body MUST set \`margin:0;background:transparent\` so the widget surface shows through.
- Pick a kind slug that describes the family, not this specific instance — "sine-wave" not "blue-sine-wave-50px".
- Don't include built-in plugin kinds (html, chart, mermaid, calendar) — the orchestrator drops collisions.
- If the HTML is too specific to generalize usefully (e.g., a fixed table of hardcoded strings), output the literal token \`SKIP\` instead of JSON.`;

function buildExtractorPrompt(input: ExtractionInput): string {
  const lines: string[] = [];
  lines.push(`User's message that triggered this render:`);
  lines.push(`> ${input.userMessage.slice(0, 500)}`);
  lines.push('');
  if (input.title) {
    lines.push(`Title the agent picked: ${input.title}`);
    lines.push('');
  }
  lines.push('HTML the agent rendered:');
  lines.push('```html');
  // Cap to ~8k chars so the prompt stays small. Most renders are well under this.
  lines.push(input.html.slice(0, 8000));
  lines.push('```');
  lines.push('');
  lines.push('Return ONLY the JSON template descriptor (or `SKIP` if too specific).');
  return lines.join('\n');
}

function parseExtractorOutput(text: string): PluginKindDescriptor | null {
  const trimmed = text.trim();
  if (trimmed === 'SKIP' || trimmed.toUpperCase() === 'SKIP') return null;

  // The LLM might wrap the JSON in ```json fences despite instructions.
  // Pull the first {...} block.
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart < 0 || jsonEnd <= jsonStart) return null;
  const slice = trimmed.slice(jsonStart, jsonEnd + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const kind = obj['kind'];
  const label = obj['label'];
  const description = obj['description'];
  const srcdoc = obj['srcdoc'];
  if (
    typeof kind !== 'string' ||
    !/^[a-z][a-z0-9-]{2,30}$/.test(kind) ||
    typeof srcdoc !== 'string' ||
    srcdoc.length < 50
  ) {
    return null;
  }
  const defaultSize = obj['default_size'];
  const sizeOK =
    typeof defaultSize === 'object' &&
    defaultSize !== null &&
    typeof (defaultSize as { w?: unknown }).w === 'number' &&
    typeof (defaultSize as { h?: unknown }).h === 'number';

  return {
    kind,
    ...(typeof label === 'string' && label.length > 0 ? { label } : {}),
    ...(typeof description === 'string' && description.length > 0
      ? { description }
      : {}),
    renderer: {
      type: 'iframe',
      sandbox: 'allow-scripts',
      srcdoc,
      ...(sizeOK
        ? {
            defaultSize: {
              w: (defaultSize as { w: number }).w,
              h: (defaultSize as { h: number }).h,
            },
          }
        : {}),
    },
  };
}

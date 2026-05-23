/**
 * Pure auto-classifier: turns an arbitrary payload (whose specialized
 * schema either doesn't exist or didn't validate) into a GenericPayload
 * with one or more typed blocks.
 *
 * Heuristics, in priority order:
 *   1. Whole payload looks like an existing specialized type → wrap as a
 *      single block of that flavor.
 *   2. Payload has multiple recognizable sub-fields → emit one block per
 *      recognized sub-shape (markdown body + table + kv + embed).
 *   3. Nothing matches → JSON dump fallback. Always succeeds.
 *
 * Pure, synchronous, no side effects, no LLM calls — safe to run inside
 * the place_widget tool's hot path.
 */

import type { GenericBlockT } from './payloads.js';

type AnyObj = Record<string, unknown>;

/**
 * Output shape — matches GenericPayload but typed loosely so this module
 * can stay free of zod imports (cheap to call from anywhere).
 */
export type GenericClassification = {
  title: string;
  subtitle?: string;
  blocks: GenericBlockT[];
  source?: string;
  sources?: unknown[];
};

/**
 * Convert any payload + an optional kind hint into a GenericPayload.
 * `originalKind` is used for the title fallback when the payload has none.
 */
export function classifyToGeneric(
  originalKind: string,
  payload: unknown,
): GenericClassification {
  const obj = isObject(payload) ? payload : {};
  const blocks: GenericBlockT[] = [];

  // 1) Whole-payload single-shape detectors (highest fidelity).
  const single = detectSingleShape(payload);
  if (single) {
    blocks.push(single);
  } else {
    // 2) Compound: pick out recognizable sub-fields.
    blocks.push(...detectCompoundBlocks(obj));
  }

  // 3) JSON fallback if we found nothing useful.
  if (blocks.length === 0) {
    blocks.push({ type: 'json', data: payload });
  }

  // Title resolution: prefer payload.title, then payload.name, then the
  // (often informative) original-kind hint.
  const title =
    pickString(obj, 'title') ??
    pickString(obj, 'name') ??
    prettifyKind(originalKind);

  const subtitleParts: string[] = [];
  if (originalKind && originalKind !== 'generic') {
    subtitleParts.push(`auto-classified from \`${originalKind}\``);
  }
  const subtitle =
    pickString(obj, 'subtitle') ??
    pickString(obj, 'description') ??
    (subtitleParts.length > 0 ? subtitleParts.join(' · ') : undefined);

  const out: GenericClassification = {
    title,
    blocks,
  };
  if (subtitle) out.subtitle = subtitle;
  // Pass attribution through if present.
  const source = pickString(obj, 'source');
  if (source) out.source = source;
  if (Array.isArray(obj['sources'])) out.sources = obj['sources'];
  return out;
}

/* ──────────────────────────────────────────────────────────────────
 * Single-shape detectors — these only fire when the WHOLE payload looks
 * like one specific block type. Keeps obvious cases tight (no compound).
 * ──────────────────────────────────────────────────────────────────*/
function detectSingleShape(payload: unknown): GenericBlockT | null {
  if (typeof payload === 'string' && payload.trim().length > 0) {
    if (isLikelyUrl(payload)) return { type: 'embed', url: payload };
    return { type: 'markdown', content: payload };
  }
  if (!isObject(payload)) return null;

  // Plain { url } — embed.
  const keys = Object.keys(payload);
  if (keys.length === 1 && typeof payload['url'] === 'string' && isLikelyUrl(payload['url'])) {
    return { type: 'embed', url: payload['url'] };
  }
  // Plain { content } or { body } string — markdown.
  for (const k of ['markdown', 'content', 'body', 'text']) {
    if (keys.length <= 2 && typeof payload[k] === 'string') {
      return { type: 'markdown', content: payload[k] as string };
    }
  }
  return null;
}

/* ──────────────────────────────────────────────────────────────────
 * Compound detector — scans the payload for known sub-shapes and emits
 * one block per match. Order matters: markdown body first (acts as
 * lede), then structured data (table, kv), then embeds last (footer).
 * ──────────────────────────────────────────────────────────────────*/
function detectCompoundBlocks(obj: AnyObj): GenericBlockT[] {
  const blocks: GenericBlockT[] = [];

  // Markdown body — common payload shape: { title, body|description }.
  for (const k of ['body', 'description', 'summary', 'markdown']) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 0) {
      blocks.push({ type: 'markdown', content: v });
      break;
    }
  }

  // Table — { columns: [...], rows: [[...]] }.
  if (Array.isArray(obj['columns']) && Array.isArray(obj['rows'])) {
    const columns = (obj['columns'] as unknown[])
      .map((c) => normalizeColumn(c))
      .filter((c): c is { key: string } => c !== null);
    const rows = (obj['rows'] as unknown[]).map((r) =>
      Array.isArray(r) ? r.map((cell) => String(cell ?? '')) : [String(r ?? '')],
    );
    if (columns.length > 0 && rows.length > 0) {
      blocks.push({ type: 'table', columns, rows });
    }
  }

  // KV — { fields: [{key, value}] } OR a flat {string: string|number}
  // when no other structured field was already used.
  if (Array.isArray(obj['fields'])) {
    const fields = (obj['fields'] as unknown[])
      .map((f) => normalizeField(f))
      .filter((f): f is { key: string; value: string } => f !== null);
    if (fields.length > 0) blocks.push({ type: 'kv', fields });
  } else if (blocks.length === 0) {
    // Last-resort KV from a flat object with primitive values.
    const flat = Object.entries(obj)
      .filter(
        ([k, v]) =>
          k !== 'title' &&
          k !== 'subtitle' &&
          k !== 'source' &&
          k !== 'sources' &&
          (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'),
      )
      .map(([k, v]) => ({ key: k, value: String(v) }));
    if (flat.length > 0) blocks.push({ type: 'kv', fields: flat });
  }

  // Embed — top-level URL field.
  if (typeof obj['url'] === 'string' && isLikelyUrl(obj['url'])) {
    blocks.push({ type: 'embed', url: obj['url'] });
  }

  return blocks;
}

/* ──────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────*/
function isObject(v: unknown): v is AnyObj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function pickString(obj: AnyObj, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function isLikelyUrl(s: string): boolean {
  return /^https?:\/\/\S+$/i.test(s);
}
function prettifyKind(kind: string): string {
  if (!kind) return 'Widget';
  return kind
    .split(/[-_]/g)
    .map((p) => (p.length === 0 ? p : p[0]!.toUpperCase() + p.slice(1)))
    .join(' ');
}
function normalizeColumn(c: unknown): { key: string; label?: string } | null {
  if (typeof c === 'string') return { key: c };
  if (isObject(c) && typeof c['key'] === 'string') {
    const out: { key: string; label?: string } = { key: c['key'] };
    if (typeof c['label'] === 'string') out.label = c['label'];
    return out;
  }
  return null;
}
function normalizeField(f: unknown): { key: string; value: string } | null {
  if (!isObject(f)) return null;
  const k = f['key'];
  const v = f['value'];
  if (typeof k !== 'string') return null;
  if (typeof v === 'string') return { key: k, value: v };
  if (typeof v === 'number' || typeof v === 'boolean') {
    return { key: k, value: String(v) };
  }
  return null;
}

/**
 * Persistence layer for user-registered plugin widget templates.
 *
 * Templates the agent (or a third-party caller) registers via
 * `register_widget_kind` live in a flat JSON file at
 * `~/.opencanvas/templates.json`. The BackendState reads this on
 * boot and re-registers every entry into the in-process WidgetRegistry
 * so prior sessions' learned templates carry over.
 *
 * Why this enables "self-improving widgets":
 *   - Each session, the agent can `register_widget_kind` for a novel
 *     pattern it built (a Mermaid wrapper, a Three.js scene shell, a
 *     custom dashboard layout, …).
 *   - On the next boot, that template is still there — available via
 *     `render` / `place_widget` and listed via `list_templates`.
 *   - Over time the agent's effective widget library grows from use.
 *
 * Shape: a flat array of `PluginKindDescriptor`. Same structure as the
 * built-in templates in `builtin-widgets.ts`; the only difference is
 * the storage location.
 *
 * Failure mode: any IO error (missing file, malformed JSON, write
 * permission) is logged and the in-memory registry continues working —
 * we never make persistence a hard requirement for chat to work.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import type { PluginKindDescriptor } from './widget-registry.js';

/** Default location — overrideable via `OPENCANVAS_TEMPLATES_PATH`. */
function templatesPath(): string {
  return (
    process.env['OPENCANVAS_TEMPLATES_PATH'] ??
    join(homedir(), '.opencanvas', 'templates.json')
  );
}

/**
 * Read persisted templates. Returns an empty array if the file
 * doesn't exist or fails to parse — never throws.
 */
export function loadPersistedTemplates(): PluginKindDescriptor[] {
  const path = templatesPath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn(`[template-persistence] ${path} is not an array; skipping`);
      return [];
    }
    // Trust-but-validate: each entry needs `kind` (string) and
    // `renderer.type === 'iframe'` with a `srcdoc` (string). Anything
    // that doesn't match is dropped with a warning rather than
    // crashing the boot.
    const out: PluginKindDescriptor[] = [];
    for (const entry of parsed) {
      if (!isValidDescriptor(entry)) {
        console.warn('[template-persistence] dropping invalid template entry');
        continue;
      }
      out.push(entry);
    }
    return out;
  } catch (e) {
    console.warn(`[template-persistence] failed to read ${path}:`, e instanceof Error ? e.message : e);
    return [];
  }
}

/**
 * Persist a single template by appending or replacing in the file.
 * Idempotent on `kind` — calling with the same id overwrites the
 * prior entry (matches the in-process registry's replace-on-register
 * semantics). Returns true on success, false on IO error.
 */
export function persistTemplate(descriptor: PluginKindDescriptor): boolean {
  const path = templatesPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const current = loadPersistedTemplates();
    const next = current.filter((t) => t.kind !== descriptor.kind);
    next.push(descriptor);
    writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    return true;
  } catch (e) {
    console.warn(`[template-persistence] failed to write ${path}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Remove a template by kind name. No-op if not present. Returns true
 * on success, false on IO error.
 */
export function deletePersistedTemplate(kind: string): boolean {
  const path = templatesPath();
  if (!existsSync(path)) return true;
  try {
    const current = loadPersistedTemplates();
    const next = current.filter((t) => t.kind !== kind);
    if (next.length === current.length) return true;
    writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    return true;
  } catch (e) {
    console.warn(`[template-persistence] failed to write ${path}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

function isValidDescriptor(x: unknown): x is PluginKindDescriptor {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o['kind'] !== 'string') return false;
  if (typeof o['renderer'] !== 'object' || o['renderer'] === null) return false;
  const r = o['renderer'] as Record<string, unknown>;
  if (r['type'] !== 'iframe') return false;
  if (typeof r['srcdoc'] !== 'string') return false;
  return true;
}

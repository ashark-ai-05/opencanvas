import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

// web-tree-sitter uses `export = Parser` (CommonJS-style module),
// so we use the namespace import form.
import Parser from 'web-tree-sitter';

let initPromise: Promise<void> | null = null;
const grammarCache = new Map<string, Parser.Language>();

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = Parser.init();
  }
  return initPromise;
}

/**
 * Resolve the path to a grammar's WASM file. We try the
 * tree-sitter-<lang> npm package layout first, then fall back to
 * sibling locations.
 */
function resolveGrammarWasm(packageName: string, wasmFileName: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', '..', 'node_modules', packageName, wasmFileName),
    join(here, '..', '..', '..', '..', 'node_modules', packageName, wasmFileName),
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    `Could not find ${wasmFileName} in any of: ${candidates.join(', ')}`
  );
}

export type LanguageId = 'typescript' | 'tsx';

const GRAMMAR_FILES: Record<LanguageId, { pkg: string; file: string }> = {
  typescript: { pkg: 'tree-sitter-typescript', file: 'tree-sitter-typescript.wasm' },
  tsx:        { pkg: 'tree-sitter-typescript', file: 'tree-sitter-tsx.wasm' },
};

/**
 * Returns a Parser configured for the given language. Lazy-loads and
 * caches the grammar on first use.
 */
export async function getParser(language: LanguageId): Promise<Parser> {
  await ensureInit();
  let grammar = grammarCache.get(language);
  if (!grammar) {
    const { pkg, file } = GRAMMAR_FILES[language];
    const wasmPath = resolveGrammarWasm(pkg, file);
    grammar = await Parser.Language.load(wasmPath);
    grammarCache.set(language, grammar);
  }
  const parser = new Parser();
  parser.setLanguage(grammar);
  return parser;
}

/**
 * Pick a language id from a file extension. Returns null for unsupported.
 */
export function languageFromExtension(ext: string): LanguageId | null {
  const lower = ext.toLowerCase();
  if (lower === '.ts' || lower === '.mts' || lower === '.cts') return 'typescript';
  if (lower === '.tsx') return 'tsx';
  if (lower === '.js' || lower === '.mjs' || lower === '.cjs') return 'typescript'; // tree-sitter-typescript handles JS
  if (lower === '.jsx') return 'tsx';
  return null;
}

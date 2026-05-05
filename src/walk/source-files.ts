/**
 * Multi-language file walker for the KB code connector.
 *
 * Used by `connectors/code.ts` to enumerate source files under a project
 * root. Filters by extension whitelist and skips well-known noise dirs
 * (node_modules, .git, dist, build, target, etc.). Returns absolute
 * paths sorted lexicographically for stable ordering across runs.
 *
 * Spec reference: REPLICATION-PROMPT.md §2 — `src/walk/source-files.ts`.
 */
import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, extname, resolve } from 'node:path';

const SOURCE_EXTENSIONS = new Set<string>([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.scala',
  '.cs',
  '.cpp',
  '.cc',
  '.c',
  '.h',
  '.hpp',
  '.swift',
  '.m',
  '.mm',
  '.php',
  '.lua',
  '.r',
  '.sh',
  '.bash',
  '.zsh',
  '.sql',
  '.yaml',
  '.yml',
  '.json',
  '.toml',
  '.md',
  '.markdown',
  '.rst',
  '.adoc',
  '.html',
  '.htm',
  '.xml',
  '.css',
  '.scss',
  '.sass',
  '.less',
]);

const SKIP_DIR_NAMES = new Set<string>([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.nuxt',
  '.cache',
  '.vite',
  '.turbo',
  '.idea',
  '.vscode',
  '__pycache__',
  '.venv',
  'venv',
  'vendor',
  'coverage',
  '.coverage',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.gradle',
  '.mvn',
  'release',
  'dist-backend',
  '.opencanvas',
]);

export type WalkOptions = {
  /**
   * Override the default extension whitelist. Pass an empty Set to walk
   * everything (text or binary — the caller is responsible for filtering).
   */
  extensions?: Set<string>;
  /** Maximum files to return; truncates lexicographically. */
  maxFiles?: number;
};

/**
 * Async-iterate every file under `rootPath` whose extension is in the
 * whitelist and whose path doesn't traverse a skip directory. Yields
 * absolute paths.
 */
export async function* walkSourceFiles(
  rootPath: string,
  options: WalkOptions = {},
): AsyncGenerator<string> {
  const ext = options.extensions ?? SOURCE_EXTENSIONS;
  const max = options.maxFiles ?? Infinity;
  const root = resolve(rootPath);

  let count = 0;
  // Iterative DFS — avoids deep-recursion stack issues on big monorepos.
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Dirent<string>[];
    try {
      entries = (await readdir(dir, {
        withFileTypes: true,
        encoding: 'utf-8',
      })) as Dirent<string>[];
    } catch {
      continue;
    }
    // Sort so traversal order is stable across runs (orchestrator cursor
    // assumes monotonic iteration to make idempotency cheaper).
    entries.sort((a, b) => a.name.localeCompare(b.name));

    // Yield files in sorted order first (so a stable lex cursor works),
    // THEN push subdirectories in reverse onto the stack so DFS visits
    // them in sorted order.
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (ext.size === 0 || ext.has(extname(e.name).toLowerCase())) {
        yield join(dir, e.name);
        count += 1;
        if (count >= max) return;
      }
    }
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (!e.isDirectory()) continue;
      if (SKIP_DIR_NAMES.has(e.name)) continue;
      if (e.name.startsWith('.') && e.name !== '.github' && e.name !== '.gitlab') continue;
      stack.push(join(dir, e.name));
    }
  }
}

/** Convenience: collect the walker into an array. */
export async function listSourceFiles(
  rootPath: string,
  options: WalkOptions = {},
): Promise<string[]> {
  const out: string[] = [];
  for await (const p of walkSourceFiles(rootPath, options)) out.push(p);
  return out;
}

/** Async file-size helper used by some connectors to skip huge blobs. */
export async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

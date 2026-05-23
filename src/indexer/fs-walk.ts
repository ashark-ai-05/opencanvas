import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'vendor']);

/**
 * Async-iterates absolute paths of .md / .markdown / .txt files under root.
 * Skips dot-directories, node_modules, and other build directories.
 */
export async function* walkTextFiles(root: string): AsyncIterable<string> {
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      yield* walkTextFiles(path);
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      yield path;
    }
  }
}

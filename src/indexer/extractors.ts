/**
 * Document text extractors keyed by file extension.
 *
 * Used by both the legacy `--index` document indexer and the KB code
 * connector when it encounters a non-source-code document. Each
 * extractor reads from disk and returns plain text suitable for
 * `splitText` chunking.
 *
 * Spec: REPLICATION-PROMPT.md §2 — `src/indexer/extractors.ts`.
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import yaml from 'yaml';

/** Returns the file's plain-text content, or null when no extractor applies. */
export async function extractText(path: string): Promise<string | null> {
  const ext = extname(path).toLowerCase();
  const extractor = EXTRACTORS[ext];
  if (!extractor) return null;
  try {
    return await extractor(path);
  } catch (err) {
    console.error(
      `[extractors] failed to read ${path}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Map of `.<ext>` → extractor. Public so tests can introspect support. */
export const EXTRACTORS: Record<string, (path: string) => Promise<string>> = {
  '.md': readUtf8,
  '.markdown': readUtf8,
  '.txt': readUtf8,
  '.rst': readUtf8,
  '.adoc': readUtf8,
  '.yaml': extractYaml,
  '.yml': extractYaml,
  '.json': extractJson,
  '.pdf': extractPdf,
  '.docx': extractDocx,
  '.xlsx': extractXlsx,
};

async function readUtf8(path: string): Promise<string> {
  return readFile(path, 'utf-8');
}

async function extractYaml(path: string): Promise<string> {
  const text = await readFile(path, 'utf-8');
  // Validate it parses; if it does, return the original text (preserves
  // comments and structure for FTS5). On parse failure, just return the
  // raw bytes — better than dropping the file.
  try {
    yaml.parse(text);
  } catch {
    /* fall through */
  }
  return text;
}

async function extractJson(path: string): Promise<string> {
  const text = await readFile(path, 'utf-8');
  try {
    // Pretty-print so FTS5 has stable token boundaries.
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

async function extractPdf(path: string): Promise<string> {
  // pdf-parse v2 ships ESM with a default *or* named export depending on
  // the build; tolerate both by destructuring the dynamic-import value.
  const mod = (await import('pdf-parse')) as unknown as {
    default?: (b: Buffer) => Promise<{ text: string }>;
    pdf?: (b: Buffer) => Promise<{ text: string }>;
  };
  const pdf = mod.default ?? mod.pdf;
  if (typeof pdf !== 'function') {
    throw new Error('pdf-parse: no default or named pdf() export found');
  }
  const buf = await readFile(path);
  const result = await pdf(buf);
  return result.text;
}

async function extractDocx(path: string): Promise<string> {
  const mammoth = await import('mammoth');
  const buf = await readFile(path);
  const result = await mammoth.extractRawText({ buffer: buf });
  return result.value;
}

async function extractXlsx(path: string): Promise<string> {
  const xlsx = await import('xlsx');
  const wb = xlsx.readFile(path);
  const sheets: string[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    sheets.push(`# Sheet: ${name}\n${xlsx.utils.sheet_to_csv(sheet)}`);
  }
  return sheets.join('\n\n');
}

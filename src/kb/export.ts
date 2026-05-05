/**
 * `pnpm cli --kb-export` writer.
 *
 * Emits one ingest-source-template-shaped JSON file per source bucket
 * plus a manifest. Only chunks with QA pairs are exported (raw-embedding
 * chunks aren't part of the template).
 *
 * Layout:
 *   <outDir>/
 *     manifest.json
 *     code/<source-id>.json
 *     jira/<source-id>.json
 *     stash/<source-id>.json
 *     confluence/<source-id>.json
 *
 * Spec: KNOWLEDGE-BASE.md — "Export".
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Store } from '../storage/store.js';

type ExportRow = {
  chunk_id: number;
  source_id: string;
  kind: string;
  uri: string;
  body: string;
  meta_json: string | null;
  queries_json: string;
  response_text: string;
};

export async function exportProject(
  store: Store,
  project: string,
  outDir: string,
): Promise<string[]> {
  const root = resolve(outDir);
  await mkdir(root, { recursive: true });

  const rows = store.db
    .prepare(
      `SELECT chunks.id AS chunk_id, chunks.source_id, chunks.kind,
              chunks.uri, chunks.body, chunks.meta_json,
              qa_pairs.queries_json, qa_pairs.response_text
       FROM chunks JOIN qa_pairs ON qa_pairs.chunk_id = chunks.id
       WHERE json_extract(chunks.meta_json, '$.project') = ?
       ORDER BY chunks.source_id, chunks.id`,
    )
    .all(project) as ExportRow[];

  // Bucket by `source-prefix` (code, jira, stash, confluence) → source_id.
  const buckets = new Map<
    string,
    Map<string, ExportRow[]>
  >();
  for (const row of rows) {
    const prefix = row.source_id.split(':')[0] ?? 'other';
    let inner = buckets.get(prefix);
    if (!inner) {
      inner = new Map();
      buckets.set(prefix, inner);
    }
    let list = inner.get(row.source_id);
    if (!list) {
      list = [];
      inner.set(row.source_id, list);
    }
    list.push(row);
  }

  const written: string[] = [];
  for (const [prefix, inner] of buckets) {
    const dir = join(root, prefix);
    await mkdir(dir, { recursive: true });
    for (const [sourceId, list] of inner) {
      const safeId = sourceId.replace(/[/:]/g, '__');
      const file = join(dir, `${safeId}.json`);
      const payload = {
        sourceId,
        chunkCount: list.length,
        chunks: list.map((r) => ({
          uri: r.uri,
          kind: r.kind,
          body: r.body,
          meta: r.meta_json ? JSON.parse(r.meta_json) : null,
          queries: JSON.parse(r.queries_json),
          response: r.response_text,
        })),
      };
      await writeFile(file, JSON.stringify(payload, null, 2), 'utf-8');
      written.push(file);
    }
  }

  const manifest = {
    project,
    generatedAt: new Date().toISOString(),
    files: written.map((f) => f.slice(root.length + 1)),
    chunkCount: rows.length,
  };
  const manifestFile = join(root, 'manifest.json');
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf-8');
  written.push(manifestFile);
  return written;
}

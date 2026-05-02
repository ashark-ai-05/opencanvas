import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import type { Store } from '../../storage/store.js';
import type { EmbeddingProvider } from '../../core/embedding-provider.js';
import { walkCodeFiles } from '../../walk/code-files.js';
import { TypeScriptAdapter } from './adapters/typescript.js';
import { chunkBySymbols } from './code-chunker.js';
import { languageFromExtension } from './parser.js';
import type { LanguageAdapter, ExtractedSymbol } from './language-adapter.js';

export type CodeIndexResult = {
  indexedFiles: number;
  chunks: number;
  symbols: number;
  errors: { path: string; error: string }[];
};

export type CodeIndexerOptions = {
  store: Store;
  embedder: EmbeddingProvider;
};

export type CodeIndexRunOptions = {
  rootPath: string;
  sourceId: string;
};

export class CodeIndexer {
  private readonly store: Store;
  private readonly embedder: EmbeddingProvider;

  // For now, two adapter instances cover the supported extensions.
  // Plan 3c.1+ adds Python / Go / Java adapters here.
  private readonly tsAdapter = new TypeScriptAdapter('typescript');
  private readonly tsxAdapter = new TypeScriptAdapter('tsx');

  constructor(options: CodeIndexerOptions) {
    this.store = options.store;
    this.embedder = options.embedder;
  }

  private adapterFor(filePath: string): LanguageAdapter | null {
    const lang = languageFromExtension(extname(filePath));
    if (lang === 'tsx') return this.tsxAdapter;
    if (lang === 'typescript') return this.tsAdapter;
    return null;
  }

  async run(opts: CodeIndexRunOptions): Promise<CodeIndexResult> {
    const errors: { path: string; error: string }[] = [];
    let indexedFiles = 0;
    let totalChunks = 0;
    let totalSymbols = 0;

    const root = resolve(opts.rootPath);

    for await (const path of walkCodeFiles(root)) {
      try {
        const adapter = this.adapterFor(path);
        if (!adapter) continue;

        const source = await readFile(path, 'utf8');
        const symbols = await adapter.extract(source);
        const chunks = chunkBySymbols(source, symbols);
        if (chunks.length === 0) continue;

        const baseUri = `file://${path}`;
        const chunkUris = chunks.map((c, i) =>
          c.kind === 'code-symbol' && c.symbolName
            ? `${baseUri}#${c.symbolName}-${i}`
            : `${baseUri}#chunk-${i}`
        );

        const vectors = await this.embedder.embed(chunks.map((c) => c.text));

        const deleteOldChunks = this.store.db.prepare(
          `DELETE FROM chunks WHERE source_id = ? AND uri LIKE ?`
        );
        const deleteOldSymbols = this.store.db.prepare(
          `DELETE FROM symbols WHERE source_id = ? AND file = ?`
        );
        const insertChunk = this.store.db.prepare(
          `INSERT INTO chunks (source_id, kind, uri, body, meta_json, embedder_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        const insertEmbedding = this.store.db.prepare(
          `INSERT INTO embeddings (chunk_id, embedding) VALUES (?, ?)`
        );
        const insertSymbol = this.store.db.prepare(
          `INSERT INTO symbols (source_id, file, name, kind, lang, refs_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );

        const tx = this.store.db.transaction(() => {
          deleteOldChunks.run(opts.sourceId, `${baseUri}%`);
          deleteOldSymbols.run(opts.sourceId, path);

          for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            const result = insertChunk.run(
              opts.sourceId,
              c.kind,
              chunkUris[i],
              c.text,
              JSON.stringify({
                startByte: c.startByte,
                endByte: c.endByte,
                symbolName: c.symbolName,
                symbolKind: c.symbolKind,
                file: path,
              }),
              this.embedder.id,
              Date.now()
            );
            const chunkId = BigInt(result.lastInsertRowid as bigint | number);
            insertEmbedding.run(chunkId, Buffer.from(vectors[i].buffer));
            totalChunks++;
          }

          for (const sym of symbols) {
            insertSymbol.run(
              opts.sourceId,
              path,
              sym.name,
              sym.kind,
              adapter.id,
              JSON.stringify(sym.refs),
              Date.now()
            );
            totalSymbols++;
          }
        });
        tx();

        indexedFiles++;
      } catch (e) {
        errors.push({
          path,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { indexedFiles, chunks: totalChunks, symbols: totalSymbols, errors };
  }
}

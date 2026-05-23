import type { ExtractedSymbol } from './language-adapter.js';

export type CodeChunk = {
  text: string;
  startByte: number;
  endByte: number;
  /** 'code-symbol' for symbol bodies, 'code-file' for non-symbol regions or whole-file fallback. */
  kind: 'code-symbol' | 'code-file';
  /** Set when kind === 'code-symbol'. */
  symbolName?: string;
  symbolKind?: ExtractedSymbol['kind'];
};

/**
 * Chunk source into:
 *   1. A "prelude" code-file chunk for any non-empty bytes before the
 *      first symbol (typically imports / module-level constants).
 *   2. One code-symbol chunk per extracted symbol.
 *   3. (Optional v1.5) "between" chunks for non-trivial bytes between
 *      symbols. Plan 3c v1 omits these — between-symbol bytes are
 *      typically just blank lines. Only the prelude is preserved.
 *   4. (Optional v1.5) "tail" chunk for trailing bytes. Same reasoning.
 *
 * Files with zero symbols return a single code-file chunk holding the
 * full source.
 */
export function chunkBySymbols(
  source: string,
  symbols: ExtractedSymbol[]
): CodeChunk[] {
  if (symbols.length === 0) {
    return [
      {
        text: source,
        startByte: 0,
        endByte: source.length,
        kind: 'code-file',
      },
    ];
  }

  // Sort by startByte for safety (queries usually return in order, but
  // be defensive).
  const sorted = [...symbols].sort((a, b) => a.startByte - b.startByte);
  const chunks: CodeChunk[] = [];

  // Prelude: bytes 0..firstSymbol.startByte
  const first = sorted[0];
  if (first.startByte > 0) {
    const preludeText = source.slice(0, first.startByte);
    if (preludeText.trim().length > 0) {
      chunks.push({
        text: preludeText,
        startByte: 0,
        endByte: first.startByte,
        kind: 'code-file',
      });
    }
  }

  // One chunk per symbol.
  for (const sym of sorted) {
    chunks.push({
      text: source.slice(sym.startByte, sym.endByte),
      startByte: sym.startByte,
      endByte: sym.endByte,
      kind: 'code-symbol',
      symbolName: sym.name,
      symbolKind: sym.kind,
    });
  }

  return chunks;
}

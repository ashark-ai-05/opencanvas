import { describe, it, expect } from 'vitest';
import { chunkBySymbols, type CodeChunk } from '../src/indexer/code/code-chunker.js';
import type { ExtractedSymbol } from '../src/indexer/code/language-adapter.js';

function makeSymbol(name: string, startByte: number, endByte: number, kind: ExtractedSymbol['kind'] = 'function'): ExtractedSymbol {
  return {
    name,
    kind,
    startByte,
    endByte,
    startRow: 0,
    endRow: 0,
    refs: [],
  };
}

describe('chunkBySymbols', () => {
  it('returns one whole-file chunk when no symbols are extracted', () => {
    const source = '// only a comment';
    const chunks = chunkBySymbols(source, []);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].kind).toBe('code-file');
    expect(chunks[0].text).toBe(source);
  });

  it('emits one chunk per symbol', () => {
    const source = 'function a() {}\nfunction b() {}\n';
    // a: [0, 15), b: [16, 31)
    const symbols = [
      makeSymbol('a', 0, 15),
      makeSymbol('b', 16, 31),
    ];
    const chunks = chunkBySymbols(source, symbols);
    const symbolChunks = chunks.filter((c) => c.kind === 'code-symbol');
    expect(symbolChunks).toHaveLength(2);
    expect(symbolChunks[0].symbolName).toBe('a');
    expect(symbolChunks[1].symbolName).toBe('b');
  });

  it('preserves source byte ranges accurately', () => {
    const source = 'function alpha() { return 1; }\nfunction beta() { return 2; }';
    const symbols = [
      makeSymbol('alpha', 0, 30),
      makeSymbol('beta', 31, 60),
    ];
    const chunks = chunkBySymbols(source, symbols);
    expect(chunks[0].text).toContain('alpha');
    expect(chunks[1].text).toContain('beta');
  });

  it('includes prelude (imports) as a code-file chunk before the first symbol', () => {
    const source = 'import { foo } from "x";\nfunction main() {}';
    const symbols = [makeSymbol('main', 25, 43)];
    const chunks = chunkBySymbols(source, symbols);

    // First chunk should be the prelude (imports)
    expect(chunks[0].kind).toBe('code-file');
    expect(chunks[0].text).toContain('import');
    // Then the main function chunk
    const mainChunk = chunks.find((c) => c.symbolName === 'main');
    expect(mainChunk).toBeDefined();
  });
});

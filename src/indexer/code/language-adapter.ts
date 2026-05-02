export type SymbolKind =
  | 'function'
  | 'class'
  | 'method'
  | 'interface'
  | 'type-alias'
  | 'variable';

/**
 * A symbol extracted from source code. Byte offsets are inclusive-exclusive
 * (`[startByte, endByte)`), measured against the UTF-8 bytes of the source.
 */
export type ExtractedSymbol = {
  name: string;
  kind: SymbolKind;
  startByte: number;
  endByte: number;
  startRow: number;        // 0-indexed line number
  endRow: number;
  /** Names referenced from inside this symbol's body (intra-file only). */
  refs: string[];
};

export interface LanguageAdapter {
  /** Stable id of the language adapter — used as `symbols.lang`. */
  readonly id: string;
  /** Which file extensions this adapter handles (e.g. ['.ts', '.tsx']). */
  readonly extensions: string[];
  /** Extract top-level + class-method symbols from source code. */
  extract(source: string): Promise<ExtractedSymbol[]>;
}

import { getParser, type LanguageId } from '../parser.js';
import type {
  ExtractedSymbol,
  LanguageAdapter,
  SymbolKind,
} from '../language-adapter.js';

/**
 * Tree-sitter query capturing the symbols we care about for TypeScript.
 * Each capture name encodes the kind, and `@name` is the identifier.
 */
const QUERY_SOURCE = `
  ; Top-level function declarations
  (function_declaration name: (identifier) @name) @function

  ; Class declarations
  (class_declaration name: (type_identifier) @name) @class

  ; Method definitions inside classes
  (method_definition name: (property_identifier) @name) @method

  ; Interface declarations
  (interface_declaration name: (type_identifier) @name) @interface

  ; Type aliases
  (type_alias_declaration name: (type_identifier) @name) @type-alias

  ; Top-level const/let with arrow function or function expression initializer
  (lexical_declaration
    (variable_declarator
      name: (identifier) @name
      value: [(arrow_function) (function_expression)])) @variable
`;

export class TypeScriptAdapter implements LanguageAdapter {
  readonly id: string;
  readonly extensions: string[];

  // Pass 'typescript' for .ts/.js or 'tsx' for .tsx/.jsx
  constructor(readonly languageId: LanguageId) {
    this.id = languageId;
    this.extensions =
      languageId === 'tsx'
        ? ['.tsx', '.jsx']
        : ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];
  }

  async extract(source: string): Promise<ExtractedSymbol[]> {
    const parser = await getParser(this.languageId);
    const tree = parser.parse(source);

    const lang = parser.getLanguage();
    // Language.query() is the typed API in web-tree-sitter 0.24.x
    const query = lang.query(QUERY_SOURCE);

    const captures = query.captures(tree.rootNode);

    // Group captures: every kind capture (`@function`, `@class`, etc.) is
    // followed by its `@name` capture. We pair them up.
    const symbols: ExtractedSymbol[] = [];

    let pending: { kind: SymbolKind; node: { startIndex: number; endIndex: number; startPosition: { row: number }; endPosition: { row: number }; text: string } } | null = null;

    const KIND_BY_CAPTURE: Record<string, SymbolKind> = {
      function: 'function',
      class: 'class',
      method: 'method',
      interface: 'interface',
      'type-alias': 'type-alias',
      variable: 'variable',
    };

    for (const cap of captures) {
      const node = cap.node;

      if (cap.name === 'name' && pending) {
        symbols.push({
          name: node.text,
          kind: pending.kind,
          startByte: pending.node.startIndex,
          endByte: pending.node.endIndex,
          startRow: pending.node.startPosition.row,
          endRow: pending.node.endPosition.row,
          refs: collectRefs(pending.node, source),
        });
        pending = null;
      } else if (KIND_BY_CAPTURE[cap.name]) {
        pending = { kind: KIND_BY_CAPTURE[cap.name], node };
      }
    }

    return symbols;
  }
}

/**
 * Collect identifier names referenced inside a node's body.
 * Walks the node's subtree and pulls every `identifier`/`type_identifier`
 * leaf that's NOT the symbol's own name. De-duped.
 */
function collectRefs(
  node: { startIndex: number; endIndex: number; text: string },
  source: string
): string[] {
  // Extract the symbol's body text and pull bare identifiers. This is
  // approximate (catches type names too, for instance), but good enough
  // for the intra-file refs feature in v1.
  const body = source.slice(node.startIndex, node.endIndex);
  const matches = body.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) ?? [];
  const KEYWORDS = new Set([
    'const', 'let', 'var', 'function', 'class', 'extends', 'implements',
    'interface', 'type', 'return', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'default', 'break', 'continue', 'throw', 'try',
    'catch', 'finally', 'new', 'typeof', 'instanceof', 'this', 'super',
    'true', 'false', 'null', 'undefined', 'void', 'public', 'private',
    'protected', 'static', 'readonly', 'async', 'await', 'yield',
    'import', 'export', 'from', 'as', 'of', 'in', 'string', 'number',
    'boolean', 'any', 'unknown', 'never',
  ]);
  const refs = new Set<string>();
  for (const m of matches) {
    if (!KEYWORDS.has(m)) refs.add(m);
  }
  return [...refs];
}

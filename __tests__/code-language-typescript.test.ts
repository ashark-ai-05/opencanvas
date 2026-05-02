import { describe, it, expect } from 'vitest';
import { TypeScriptAdapter } from '../src/indexer/code/adapters/typescript.js';

describe('TypeScriptAdapter', () => {
  const adapter = new TypeScriptAdapter('typescript');

  it('extracts a top-level function', async () => {
    const source = `function add(a: number, b: number) { return a + b; }`;
    const symbols = await adapter.extract(source);
    expect(symbols.find((s) => s.name === 'add' && s.kind === 'function')).toBeDefined();
  });

  it('extracts a class and its methods', async () => {
    const source = `
      class Greeter {
        constructor(public name: string) {}
        greet(): string { return 'hi ' + this.name; }
        farewell(): string { return 'bye ' + this.name; }
      }
    `;
    const symbols = await adapter.extract(source);
    expect(symbols.find((s) => s.name === 'Greeter' && s.kind === 'class')).toBeDefined();
    expect(symbols.find((s) => s.name === 'greet' && s.kind === 'method')).toBeDefined();
    expect(symbols.find((s) => s.name === 'farewell' && s.kind === 'method')).toBeDefined();
  });

  it('extracts interfaces and type aliases', async () => {
    const source = `
      interface Animal { name: string }
      type ID = string | number;
    `;
    const symbols = await adapter.extract(source);
    expect(symbols.find((s) => s.name === 'Animal' && s.kind === 'interface')).toBeDefined();
    expect(symbols.find((s) => s.name === 'ID' && s.kind === 'type-alias')).toBeDefined();
  });

  it('records intra-file refs for a function that calls another', async () => {
    const source = `
      function helper(x: number) { return x + 1; }
      function main(y: number) { return helper(y) * 2; }
    `;
    const symbols = await adapter.extract(source);
    const main = symbols.find((s) => s.name === 'main');
    expect(main?.refs).toContain('helper');
  });

  it('records valid byte ranges that reproduce the source', async () => {
    const source = `function foo() { return 1; }\nfunction bar() { return 2; }`;
    const symbols = await adapter.extract(source);
    const foo = symbols.find((s) => s.name === 'foo')!;
    const fooSource = source.slice(foo.startByte, foo.endByte);
    expect(fooSource).toContain('foo');
    expect(fooSource).toContain('return 1');
  });

  it('returns an empty array for source with no recognizable symbols', async () => {
    const symbols = await adapter.extract(`// just a comment`);
    expect(symbols).toEqual([]);
  });
});

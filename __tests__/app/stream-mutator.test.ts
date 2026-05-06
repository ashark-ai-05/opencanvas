import { describe, it, expect, vi } from 'vitest';
import {
  applyOp,
  applyOps,
  setIn,
} from '../../app/src/canvas/stream-mutator';

describe('stream-mutator', () => {
  describe('append-text', () => {
    it('appends to a markdown block', () => {
      const props = {
        title: 't',
        blocks: [{ type: 'markdown', content: 'hello ' }],
      };
      const next = applyOp(props, {
        kind: 'append-text',
        blockIndex: 0,
        text: 'world',
      });
      expect(next).not.toBeNull();
      expect((next!.blocks as Array<{ content: string }>)[0]!.content).toBe(
        'hello world',
      );
    });

    it('returns null for missing block', () => {
      const props = { blocks: [{ type: 'markdown', content: '' }] };
      const next = applyOp(props, {
        kind: 'append-text',
        blockIndex: 5,
        text: 'x',
      });
      expect(next).toBeNull();
    });

    it('returns null for wrong block type', () => {
      const props = { blocks: [{ type: 'table', columns: [], rows: [] }] };
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const next = applyOp(props, {
        kind: 'append-text',
        blockIndex: 0,
        text: 'x',
      });
      expect(next).toBeNull();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('seeds content when target.content is missing', () => {
      const props = { blocks: [{ type: 'markdown' }] };
      const next = applyOp(props, {
        kind: 'append-text',
        blockIndex: 0,
        text: 'first',
      });
      expect((next!.blocks as Array<{ content: string }>)[0]!.content).toBe(
        'first',
      );
    });
  });

  describe('append-rows', () => {
    it('pushes rows onto a table block', () => {
      const props = {
        blocks: [
          { type: 'table', columns: [{ key: 'n' }], rows: [['1']] },
        ],
      };
      const next = applyOp(props, {
        kind: 'append-rows',
        blockIndex: 0,
        rows: [['2'], ['3']],
      });
      expect((next!.blocks as Array<{ rows: string[][] }>)[0]!.rows).toEqual([
        ['1'],
        ['2'],
        ['3'],
      ]);
    });

    it('seeds rows on a table without prior rows', () => {
      const props = { blocks: [{ type: 'table', columns: [], rows: [] }] };
      const next = applyOp(props, {
        kind: 'append-rows',
        blockIndex: 0,
        rows: [['first']],
      });
      expect((next!.blocks as Array<{ rows: string[][] }>)[0]!.rows).toEqual([
        ['first'],
      ]);
    });

    it('rejects on non-table block', () => {
      const props = { blocks: [{ type: 'markdown', content: '' }] };
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(
        applyOp(props, { kind: 'append-rows', blockIndex: 0, rows: [['x']] }),
      ).toBeNull();
    });
  });

  describe('append-field', () => {
    it('pushes a field onto a kv block', () => {
      const props = {
        blocks: [{ type: 'kv', fields: [{ key: 'a', value: '1' }] }],
      };
      const next = applyOp(props, {
        kind: 'append-field',
        blockIndex: 0,
        field: { key: 'b', value: '2', url: 'https://x.com' },
      });
      expect(
        (next!.blocks as Array<{ fields: unknown[] }>)[0]!.fields,
      ).toEqual([
        { key: 'a', value: '1' },
        { key: 'b', value: '2', url: 'https://x.com' },
      ]);
    });
  });

  describe('append-block / replace-block', () => {
    it('appends a new block to the array', () => {
      const props = { blocks: [{ type: 'markdown', content: 'a' }] };
      const next = applyOp(props, {
        kind: 'append-block',
        block: { type: 'embed', url: 'https://x.com' },
      });
      expect((next!.blocks as Array<{ type: string }>)[1]!.type).toBe('embed');
    });

    it('replaces an existing block', () => {
      const props = {
        blocks: [
          { type: 'markdown', content: 'old' },
          { type: 'markdown', content: 'b' },
        ],
      };
      const next = applyOp(props, {
        kind: 'replace-block',
        blockIndex: 0,
        block: { type: 'markdown', content: 'new' },
      });
      expect(
        (next!.blocks as Array<{ content: string }>)[0]!.content,
      ).toBe('new');
    });

    it('rejects out-of-range replace-block', () => {
      const props = { blocks: [{ type: 'markdown', content: 'a' }] };
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(
        applyOp(props, {
          kind: 'replace-block',
          blockIndex: 7,
          block: { type: 'markdown', content: 'x' },
        }),
      ).toBeNull();
    });
  });

  describe('set-prop', () => {
    it('sets a top-level prop', () => {
      const props = { title: 'old' };
      const next = applyOp(props, { kind: 'set-prop', path: ['title'], value: 'new' });
      expect(next!.title).toBe('new');
    });

    it('sets a nested prop, creating intermediates', () => {
      const props = {};
      const next = applyOp(props, {
        kind: 'set-prop',
        path: ['meta', 'a', 'b'],
        value: 7,
      });
      expect(next).toEqual({ meta: { a: { b: 7 } } });
    });

    it('rejects empty path', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(
        applyOp({}, { kind: 'set-prop', path: [], value: 1 }),
      ).toBeNull();
    });

    it('does not mutate input', () => {
      const props = { title: 'old', nested: { a: 1 } };
      applyOp(props, { kind: 'set-prop', path: ['nested', 'a'], value: 99 });
      expect(props.nested.a).toBe(1);
    });
  });

  describe('applyOps batching', () => {
    it('applies ops in order, returns final props', () => {
      const props = {
        title: 't',
        blocks: [{ type: 'markdown', content: '' }],
      };
      const next = applyOps(props, [
        { kind: 'append-text', blockIndex: 0, text: 'hello ' },
        { kind: 'append-text', blockIndex: 0, text: 'world' },
        { kind: 'append-block', block: { type: 'embed', url: 'https://x.com' } },
      ]);
      expect((next!.blocks as Array<{ type: string }>)[0]!.type).toBe('markdown');
      expect((next!.blocks as Array<{ content?: string }>)[0]!.content).toBe(
        'hello world',
      );
      expect((next!.blocks as Array<{ type: string }>)[1]!.type).toBe('embed');
    });

    it('skips invalid ops but applies the rest', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const props = { blocks: [{ type: 'markdown', content: '' }] };
      const next = applyOps(props, [
        { kind: 'append-rows', blockIndex: 0, rows: [['x']] }, // invalid (markdown, not table)
        { kind: 'append-text', blockIndex: 0, text: 'ok' },
      ]);
      expect((next!.blocks as Array<{ content: string }>)[0]!.content).toBe('ok');
    });

    it('returns null when every op is invalid', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const props = { blocks: [{ type: 'markdown', content: '' }] };
      const next = applyOps(props, [
        { kind: 'append-rows', blockIndex: 0, rows: [['x']] },
        { kind: 'append-field', blockIndex: 0, field: { key: 'a', value: 'b' } },
      ]);
      expect(next).toBeNull();
    });
  });

  describe('setIn helper', () => {
    it('sets at top level on a plain object', () => {
      expect(setIn({ a: 1 }, ['b'], 2)).toEqual({ a: 1, b: 2 });
    });
    it('replaces an array index', () => {
      expect(setIn(['a', 'b', 'c'], [1], 'X')).toEqual(['a', 'X', 'c']);
    });
    it('creates nested arrays for numeric path elements', () => {
      expect(setIn({}, ['rows', 0, 'name'], 'a')).toEqual({
        rows: [{ name: 'a' }],
      });
    });
  });
});

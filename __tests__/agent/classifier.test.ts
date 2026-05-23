import { describe, it, expect } from 'vitest';
import { classifyToGeneric } from '../../src/agent/classifier.js';
import { GenericPayload } from '../../src/agent/payloads.js';

describe('classifyToGeneric', () => {
  it('produces a payload that validates against GenericPayload schema', () => {
    const result = classifyToGeneric('mystery', { foo: 'bar', n: 1 });
    const r = GenericPayload.safeParse(result);
    expect(r.success).toBe(true);
  });

  describe('single-shape detection', () => {
    it('classifies a bare URL string as embed', () => {
      const r = classifyToGeneric('weather', 'https://example.com/widget');
      expect(r.blocks).toEqual([
        { type: 'embed', url: 'https://example.com/widget' },
      ]);
    });

    it('classifies a bare string as markdown', () => {
      const r = classifyToGeneric('note', 'Hello **world**');
      expect(r.blocks).toEqual([
        { type: 'markdown', content: 'Hello **world**' },
      ]);
    });

    it('classifies { url } as embed', () => {
      const r = classifyToGeneric('chart', { url: 'https://example.com/c' });
      expect(r.blocks).toEqual([
        { type: 'embed', url: 'https://example.com/c' },
      ]);
    });

    it('classifies { content } as markdown', () => {
      const r = classifyToGeneric('post', { content: 'hello' });
      expect(r.blocks).toEqual([{ type: 'markdown', content: 'hello' }]);
    });

    it('classifies { body } as markdown', () => {
      const r = classifyToGeneric('post', { body: 'hello' });
      expect(r.blocks).toEqual([{ type: 'markdown', content: 'hello' }]);
    });
  });

  describe('compound detection', () => {
    it('extracts a markdown body block from { title, body }', () => {
      const r = classifyToGeneric('article', {
        title: 'Top story',
        body: 'Lots of news.',
      });
      // title should NOT also become a block — it's the card title.
      expect(r.title).toBe('Top story');
      expect(r.blocks).toContainEqual({
        type: 'markdown',
        content: 'Lots of news.',
      });
    });

    it('produces a table block from { columns, rows }', () => {
      const r = classifyToGeneric('candlestick', {
        title: 'BTC OHLC',
        columns: [{ key: 'time' }, { key: 'open' }, { key: 'close' }],
        rows: [
          ['09:00', '67000', '67500'],
          ['10:00', '67500', '67200'],
        ],
      });
      expect(r.blocks).toContainEqual({
        type: 'table',
        columns: [{ key: 'time' }, { key: 'open' }, { key: 'close' }],
        rows: [
          ['09:00', '67000', '67500'],
          ['10:00', '67500', '67200'],
        ],
      });
    });

    it('coerces non-string cells to strings in tables', () => {
      const r = classifyToGeneric('numbers', {
        columns: [{ key: 'n' }],
        rows: [[1], [2], [3]],
      });
      const table = r.blocks.find((b) => b.type === 'table');
      expect(table).toMatchObject({
        rows: [['1'], ['2'], ['3']],
      });
    });

    it('produces a kv block from { fields }', () => {
      const r = classifyToGeneric('weather', {
        title: 'Now',
        fields: [
          { key: 'temp', value: '72°F' },
          { key: 'humidity', value: '40%' },
        ],
      });
      expect(r.blocks).toContainEqual({
        type: 'kv',
        fields: [
          { key: 'temp', value: '72°F' },
          { key: 'humidity', value: '40%' },
        ],
      });
    });

    it('falls back to flat-object kv when no fields array exists', () => {
      const r = classifyToGeneric('stats', {
        title: 'BTC',
        price: 67500,
        change: '+1.2%',
        volume: 1234567,
      });
      const kv = r.blocks.find((b) => b.type === 'kv');
      expect(kv).toBeDefined();
      if (kv?.type !== 'kv') return;
      expect(kv.fields).toEqual(
        expect.arrayContaining([
          { key: 'price', value: '67500' },
          { key: 'change', value: '+1.2%' },
          { key: 'volume', value: '1234567' },
        ]),
      );
    });

    it('appends an embed block when payload has a top-level url', () => {
      const r = classifyToGeneric('chart', {
        title: 'Live',
        body: 'Streaming candles',
        url: 'https://tradingview.com/embed/btc',
      });
      expect(r.blocks.find((b) => b.type === 'embed')).toEqual({
        type: 'embed',
        url: 'https://tradingview.com/embed/btc',
      });
      expect(r.blocks.find((b) => b.type === 'markdown')).toBeDefined();
    });

    it('combines markdown body + table + embed in source order', () => {
      const r = classifyToGeneric('btc-dashboard', {
        title: 'BTC',
        body: 'Bitcoin spot price overview.',
        columns: [{ key: 'time' }, { key: 'price' }],
        rows: [['09:00', '67000']],
        url: 'https://tradingview.com/btc',
      });
      const types = r.blocks.map((b) => b.type);
      expect(types).toEqual(['markdown', 'table', 'embed']);
    });
  });

  describe('JSON fallback', () => {
    it('emits a json block when nothing else matches', () => {
      const r = classifyToGeneric('mystery', { weird: { nested: { x: [1, 2, 3] } } });
      // No fields/columns/rows/url/body — only the nested object → kv won't
      // fire (no primitive top-level entries) so the JSON fallback applies.
      expect(r.blocks).toEqual([
        { type: 'json', data: { weird: { nested: { x: [1, 2, 3] } } } },
      ]);
    });

    it('emits a json block for an empty payload', () => {
      const r = classifyToGeneric('empty', {});
      expect(r.blocks).toEqual([{ type: 'json', data: {} }]);
    });

    it('emits a json block for null/undefined', () => {
      const r1 = classifyToGeneric('null', null);
      expect(r1.blocks).toEqual([{ type: 'json', data: null }]);
      const r2 = classifyToGeneric('undef', undefined);
      expect(r2.blocks).toEqual([{ type: 'json', data: undefined }]);
    });
  });

  describe('title + subtitle resolution', () => {
    it('uses payload.title when present', () => {
      const r = classifyToGeneric('whatever', { title: 'My Card', body: 'b' });
      expect(r.title).toBe('My Card');
    });

    it('falls back to prettified kind when no title is in payload', () => {
      const r = classifyToGeneric('candlestick-chart', { foo: 'bar' });
      expect(r.title).toBe('Candlestick Chart');
    });

    it('annotates subtitle with the original kind for traceability', () => {
      const r = classifyToGeneric('candlestick', { foo: 'bar' });
      expect(r.subtitle).toMatch(/candlestick/);
    });

    it('prefers payload.subtitle over the auto-annotation', () => {
      const r = classifyToGeneric('candlestick', {
        title: 't',
        subtitle: 'Real-time prices',
      });
      expect(r.subtitle).toBe('Real-time prices');
    });
  });

  describe('attribution passthrough', () => {
    it('forwards source + sources from the payload', () => {
      const r = classifyToGeneric('x', {
        title: 'T',
        body: 'b',
        source: 'jira:PROJ-123',
        sources: ['https://jira.example.com/PROJ-123'],
      });
      expect(r.source).toBe('jira:PROJ-123');
      expect(r.sources).toEqual(['https://jira.example.com/PROJ-123']);
    });
  });
});

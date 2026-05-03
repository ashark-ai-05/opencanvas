import { describe, it, expect, vi } from 'vitest';
import { placeResultsOnCanvas } from '../../app/src/canvas/dispatcher';
import type { SearchResult } from '../../app/src/api/search';

describe('placeResultsOnCanvas', () => {
  it('creates one shape per result', () => {
    const editor = { createShape: vi.fn(), getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) };
    const results: SearchResult[] = [
      {
        id: '1', sourceId: 's', kind: 'text-document',
        shape: { title: 'A', body: '...' },
        provenance: { uri: 'file://a', fetchedAt: 0 }, freshness: {}, links: [],
      },
      {
        id: '2', sourceId: 's', kind: 'code-symbol',
        shape: { symbolName: 'foo', filePath: 'a.ts', body: 'fn' },
        provenance: { uri: 'file://a.ts#foo', fetchedAt: 0 }, freshness: {}, links: [],
      },
    ];

    placeResultsOnCanvas(editor as never, results);

    expect(editor.createShape).toHaveBeenCalledTimes(2);
  });

  it('maps a text-document result to the markdown shape type', () => {
    const editor = { createShape: vi.fn(), getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) };
    placeResultsOnCanvas(editor as never, [
      {
        id: '1', sourceId: 's', kind: 'text-document',
        shape: { title: 'A', body: 'B' },
        provenance: { uri: 'file://a', fetchedAt: 0 }, freshness: {}, links: [],
      },
    ]);
    const call = editor.createShape.mock.calls[0][0];
    expect(call.type).toBe('strata:markdown');
    expect(call.props.title).toBe('A');
    expect(call.props.body).toBe('B');
  });

  it('maps a code-symbol result to the code-block shape type with metadata', () => {
    const editor = { createShape: vi.fn(), getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) };
    placeResultsOnCanvas(editor as never, [
      {
        id: '1', sourceId: 's', kind: 'code-symbol',
        shape: { symbolName: 'foo', filePath: 'a.ts', language: 'typescript', body: 'fn' },
        provenance: { uri: 'file://a.ts#foo', fetchedAt: 0 }, freshness: {}, links: [],
      },
    ]);
    const call = editor.createShape.mock.calls[0][0];
    expect(call.type).toBe('strata:code-block');
    expect(call.props.symbolName).toBe('foo');
    expect(call.props.filePath).toBe('a.ts');
    expect(call.props.language).toBe('typescript');
  });

  it('falls back to key-value-card for kinds that map to it (k8s-resource)', () => {
    const editor = { createShape: vi.fn(), getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) };
    placeResultsOnCanvas(editor as never, [
      {
        id: '1', sourceId: 's', kind: 'k8s-resource' as never,
        shape: { title: 'pod', fields: [{ key: 'name', value: 'x' }] },
        provenance: { uri: 'k8s://pod', fetchedAt: 0 }, freshness: {}, links: [],
      },
    ]);
    const call = editor.createShape.mock.calls[0][0];
    expect(call.type).toBe('strata:key-value-card');
  });

  it('routes log-stream to timeline shape', () => {
    const editor = { createShape: vi.fn(), getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) };
    placeResultsOnCanvas(editor as never, [
      {
        id: '1', sourceId: 's', kind: 'log-stream' as never,
        shape: { title: 'log' },
        provenance: { uri: 'mem://log', fetchedAt: 0 }, freshness: {}, links: [],
      },
    ]);
    const call = editor.createShape.mock.calls[0][0];
    expect(call.type).toBe('strata:timeline');
  });

  it('routes table-row-set to table shape', () => {
    const editor = { createShape: vi.fn(), getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) };
    placeResultsOnCanvas(editor as never, [
      {
        id: '1', sourceId: 's', kind: 'table-row-set' as never,
        shape: { title: 'rows' },
        provenance: { uri: 'sql://rows', fetchedAt: 0 }, freshness: {}, links: [],
      },
    ]);
    const call = editor.createShape.mock.calls[0][0];
    expect(call.type).toBe('strata:table');
  });
});

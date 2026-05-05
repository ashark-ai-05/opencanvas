import { describe, it, expect } from 'vitest';
import { TEMPLATES, TEMPLATES_BY_ID } from '../../app/src/canvas/templates';
import type { SearchResult } from '../../app/src/api/search';
import type { Box } from 'tldraw';

const VIEWPORT = { x: 0, y: 0, w: 1500, h: 1000 } as Box;

function fakeResults(): SearchResult[] {
  return [
    {
      id: '1', sourceId: 'src-a', kind: 'text-document',
      shape: { title: 'Doc 1', body: 'body' },
      provenance: { uri: 'mem://doc1', fetchedAt: 1000 },
      freshness: {}, links: [],
    },
    {
      id: '2', sourceId: 'src-b', kind: 'code-symbol',
      shape: { symbolName: 'foo', filePath: 'a.ts', body: 'fn' },
      provenance: { uri: 'file://a.ts#foo', fetchedAt: 2000 },
      freshness: {}, links: [],
    },
    {
      id: '3', sourceId: 'src-a', kind: 'ticket',
      shape: { title: 'Bug 42', description: 'broken' },
      provenance: { uri: 'jira://42', fetchedAt: 3000 },
      freshness: {}, links: [],
    },
  ];
}

describe('canvas templates', () => {
  it('exposes all 4 expected templates by id', () => {
    expect(TEMPLATES).toHaveLength(4);
    expect(TEMPLATES_BY_ID['ask-anything']).toBeDefined();
    expect(TEMPLATES_BY_ID['tell-me-about-x']).toBeDefined();
    expect(TEMPLATES_BY_ID['whats-new-since-y']).toBeDefined();
    expect(TEMPLATES_BY_ID['trace-x-everywhere']).toBeDefined();
  });

  it('AskAnything: produces one placement per result', () => {
    const placements = TEMPLATES_BY_ID['ask-anything'].layout(fakeResults(), VIEWPORT);
    expect(placements).toHaveLength(3);
  });

  it('TellMeAboutX: places code-symbol in the code zone (left column)', () => {
    const placements = TEMPLATES_BY_ID['tell-me-about-x'].layout(fakeResults(), VIEWPORT);
    const codePlacement = placements.find((p) => p.shapeType === 'opencanvas:code-block');
    expect(codePlacement).toBeDefined();
    // Code zone is at x=0 relative; with padding originX=80, expect roughly there
    expect(codePlacement!.x).toBeLessThan(200);
  });

  it('WhatsNewSinceY: x increases with fetchedAt (within the same lane the older is left)', () => {
    const placements = TEMPLATES_BY_ID['whats-new-since-y'].layout(fakeResults(), VIEWPORT);
    // Find Doc 1 (oldest, fetchedAt=1000) and Bug 42 (newest in src-a, fetchedAt=3000)
    const doc1 = placements.find((p) => (p.props as { title?: string }).title === 'Doc 1');
    const bug42 = placements.find((p) => (p.props as { title?: string }).title === 'Bug 42');
    expect(doc1).toBeDefined();
    expect(bug42).toBeDefined();
    // Both are in src-a so same lane; older one should be to the left.
    expect(doc1!.x).toBeLessThan(bug42!.x);
  });

  it('TraceXEverywhere: includes a centre subject + one placement per result', () => {
    const placements = TEMPLATES_BY_ID['trace-x-everywhere'].layout(fakeResults(), VIEWPORT);
    // n results + 1 centre placeholder
    expect(placements).toHaveLength(4);
    // The centre placeholder is a key-value-card
    const subjects = placements.filter(
      (p) => p.shapeType === 'opencanvas:key-value-card' && (p.props as { title?: string }).title === 'Subject'
    );
    expect(subjects).toHaveLength(1);
  });

  it('every template handles an empty result list without throwing', () => {
    for (const t of TEMPLATES) {
      expect(t.layout([], VIEWPORT)).toEqual([]);
    }
  });
});

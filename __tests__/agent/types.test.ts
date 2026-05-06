import { describe, it, expect } from 'vitest';
import {
  WIDGET_KINDS,
  COMPOSITE_SECTION_KINDS,
  ROLES,
  TEMPLATE_IDS,
  type ToolDirective,
} from '../../src/agent/types.js';

describe('agent/types', () => {
  it('WIDGET_KINDS contains all registered kinds (12 specialized + generic + time)', () => {
    expect([...WIDGET_KINDS]).toEqual([
      'markdown',
      'code-block',
      'ticket',
      'web-embed',
      'key-value-card',
      'table',
      'timeline',
      'file-tree',
      'composite',
      'tasks',
      'kanban',
      'sticky-note',
      'generic',
      'time',
    ]);
  });

  it('COMPOSITE_SECTION_KINDS excludes composite (no nesting)', () => {
    expect(COMPOSITE_SECTION_KINDS).not.toContain('composite');
    expect(COMPOSITE_SECTION_KINDS.length).toBe(WIDGET_KINDS.length - 1);
  });

  it('ROLES enumerates 6 logical roles', () => {
    expect([...ROLES]).toEqual([
      'primary',
      'detail',
      'related',
      'reference',
      'timeline',
      'node',
    ]);
  });

  it('TEMPLATE_IDS matches the 4 canvas templates', () => {
    expect([...TEMPLATE_IDS]).toEqual([
      'ask-anything',
      'tell-me-about-x',
      'whats-new-since-y',
      'trace-x-everywhere',
    ]);
  });

  it('ToolDirective discriminates on `type` — exhaustive switch must compile', () => {
    const directives: ToolDirective[] = [
      {
        type: 'place',
        id: 'w-1',
        kind: 'markdown',
        role: 'primary',
        payload: { title: 't', body: 'b' },
      },
      {
        type: 'update',
        id: 'w-1',
        payload: { body: 'updated' },
      },
      { type: 'link', linkId: 'l-1', fromId: 'w-1', toId: 'w-2' },
      { type: 'focus', id: 'w-1' },
      { type: 'clear' },
      { type: 'switchTemplate', id: 'ask-anything' },
      {
        type: 'stream-start',
        id: 'w-3',
        kind: 'generic',
        role: 'primary',
        scaffold: { title: 'Streaming', blocks: [] },
      },
      {
        type: 'stream-op',
        id: 'w-3',
        seq: 1,
        op: { kind: 'append-text', blockIndex: 0, text: 'hello' },
      },
      { type: 'stream-end', id: 'w-3', ok: true },
    ];
    const seen = new Set<string>();
    for (const d of directives) {
      switch (d.type) {
        case 'place':
          seen.add('place');
          break;
        case 'update':
          seen.add('update');
          break;
        case 'link':
          seen.add('link');
          break;
        case 'focus':
          seen.add('focus');
          break;
        case 'clear':
          seen.add('clear');
          break;
        case 'switchTemplate':
          seen.add('switchTemplate');
          break;
        case 'stream-start':
          seen.add('stream-start');
          break;
        case 'stream-op':
          seen.add('stream-op');
          break;
        case 'stream-end':
          seen.add('stream-end');
          break;
        default: {
          // Exhaustiveness: `d` is `never` here. Build fails if a variant
          // is added without a case branch.
          const _exhaustive: never = d;
          throw new Error(`unhandled directive: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }
    expect(seen.size).toBe(9);
  });
});

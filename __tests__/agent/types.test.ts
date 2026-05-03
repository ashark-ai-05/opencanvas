import { describe, it, expect } from 'vitest';
import {
  WIDGET_KINDS,
  ROLES,
  TEMPLATE_IDS,
  type ToolDirective,
} from '../../src/agent/types.js';

describe('agent/types', () => {
  it('WIDGET_KINDS contains the 8 registered kinds (5 from Plan 4c + 3 from Phase 4)', () => {
    expect([...WIDGET_KINDS]).toEqual([
      'markdown',
      'code-block',
      'ticket',
      'web-embed',
      'key-value-card',
      'table',
      'timeline',
      'file-tree',
    ]);
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

  it('TEMPLATE_IDS matches the 4 templates from Plan 4e', () => {
    expect([...TEMPLATE_IDS]).toEqual([
      'ask-anything',
      'tell-me-about-x',
      'whats-new-since-y',
      'trace-x-everywhere',
    ]);
  });

  it('ToolDirective discriminates on `type` — exhaustive switch must compile', () => {
    // Compile-time check: a switch with all 5 variants narrows correctly to
    // `never` in the default branch. If a variant is added or its discriminant
    // changes, this stops compiling and the test breaks the build.
    const directives: ToolDirective[] = [
      { type: 'place', id: 'w-1', kind: 'markdown', role: 'primary',
        payload: { title: 't', body: 'b' } },
      { type: 'link', linkId: 'l-1', fromId: 'w-1', toId: 'w-2' },
      { type: 'focus', id: 'w-1' },
      { type: 'clear' },
      { type: 'switchTemplate', id: 'ask-anything' },
    ];
    const seen = new Set<string>();
    for (const d of directives) {
      switch (d.type) {
        case 'place': seen.add('place'); break;
        case 'link': seen.add('link'); break;
        case 'focus': seen.add('focus'); break;
        case 'clear': seen.add('clear'); break;
        case 'switchTemplate': seen.add('switchTemplate'); break;
        default: {
          // Exhaustiveness: `d` is `never` here. Build fails if a variant
          // is added without a case branch.
          const _exhaustive: never = d;
          throw new Error(`unhandled directive: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }
    expect(seen.size).toBe(5);
  });
});

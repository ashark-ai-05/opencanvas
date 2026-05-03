import { describe, it, expect } from 'vitest';
import {
  WIDGET_KINDS,
  ROLES,
  TEMPLATE_IDS,
  type ToolDirective,
} from '../../src/agent/types.js';

describe('agent/types', () => {
  it('WIDGET_KINDS contains the 5 kinds registered in Plan 4c', () => {
    expect([...WIDGET_KINDS]).toEqual([
      'markdown',
      'code-block',
      'ticket',
      'web-embed',
      'key-value-card',
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

  it('ToolDirective is a discriminated union over `type`', () => {
    const place: ToolDirective = {
      type: 'place',
      id: 'w-1',
      kind: 'markdown',
      role: 'primary',
      payload: { title: 't', body: 'b' },
    };
    const link: ToolDirective = {
      type: 'link',
      linkId: 'l-1',
      fromId: 'w-1',
      toId: 'w-2',
    };
    const focus: ToolDirective = { type: 'focus', id: 'w-1' };
    const clear: ToolDirective = { type: 'clear' };
    const tmpl: ToolDirective = { type: 'switchTemplate', id: 'ask-anything' };

    const all = [place, link, focus, clear, tmpl];
    expect(all).toHaveLength(5);
  });
});

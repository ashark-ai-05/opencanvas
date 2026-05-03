import { describe, it, expect } from 'vitest';
import { buildAgentTools } from '../../src/agent/tools/index.js';
import type { CanvasSnapshot } from '../../src/agent/canvas-snapshot.js';

const fakeSearch = {
  search: async () => [],
  fetchById: async () => null,
};
const emptySnap: CanvasSnapshot = {
  activeTemplateId: 'ask-anything',
  widgets: [],
};

describe('buildAgentTools', () => {
  it('returns the 9 tools in declared order', () => {
    const tools = buildAgentTools({
      search: fakeSearch,
      getSnapshot: () => emptySnap,
    });
    expect(tools.map((t) => t.name)).toEqual([
      'search_kb',
      'fetch_result',
      'place_widget',
      'read_canvas',
      'read_widget',
      'focus_widget',
      'link_widgets',
      'clear_canvas',
      'switch_template',
    ]);
  });

  it('every tool has a description and inputSchema', () => {
    const tools = buildAgentTools({
      search: fakeSearch,
      getSnapshot: () => emptySnap,
    });
    for (const t of tools) {
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeDefined();
      expect(typeof t.handler).toBe('function');
    }
  });
});

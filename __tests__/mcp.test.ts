import { describe, it, expect } from 'vitest';
import type { Source, SourceTool, ResultKind } from '../src/core/source.js';

describe('core/source types', () => {
  it('exports a Source type with the expected shape', () => {
    // Compile-time check via type assertion. If the type's missing fields
    // or has wrong types, this won't compile.
    const s: Source = {
      id: 'test',
      name: 'Test Source',
      health: 'connected',
      tools: [],
    };
    expect(s.id).toBe('test');
  });

  it('SourceTool carries name, description, inputSchema', () => {
    const t: SourceTool = {
      name: 'read_file',
      description: 'Read file contents',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    };
    expect(t.name).toBe('read_file');
  });

  it('ResultKind union accepts all 15 kinds', () => {
    const kinds: ResultKind[] = [
      'text-document',
      'wiki-page',
      'code-file',
      'code-symbol',
      'code-diff',
      'ticket',
      'log-stream',
      'k8s-resource',
      'web-page',
      'image',
      'table-row-set',
      'metric-series',
      'chat-message',
      'runbook',
      'dashboard-embed',
    ];
    expect(kinds).toHaveLength(15);
  });
});

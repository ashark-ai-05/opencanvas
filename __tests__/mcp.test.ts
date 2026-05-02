import { describe, it, expect } from 'vitest';
import type { Source, SourceTool, ResultKind } from '../src/core/source.js';
import { MCPSource } from '../src/mcp/source.js';
import { SourceRegistry } from '../src/mcp/registry.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

class FakeClient {
  // Just enough surface for MCPSource to call.
  async listTools() {
    return {
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object' as const, properties: {} },
        },
      ],
    };
  }
  async callTool(args: { name: string; arguments?: unknown }) {
    return { content: [{ type: 'text' as const, text: `called ${args.name}` }] };
  }
  async close() {}
}

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

describe('MCPSource', () => {
  it('introspects tools via listTools()', async () => {
    const source = new MCPSource('fs', 'Filesystem', new FakeClient() as unknown as Client);
    const result = await source.introspect();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('read_file');
    expect(source.health).toBe('connected');
  });

  it('callTool delegates to the underlying client', async () => {
    const source = new MCPSource('fs', 'Filesystem', new FakeClient() as unknown as Client);
    const out = await source.callTool('read_file', { path: '/etc/hostname' });
    expect(out).toBeDefined();
  });

  it('marks source disconnected after close()', async () => {
    const source = new MCPSource('fs', 'Filesystem', new FakeClient() as unknown as Client);
    await source.close();
    expect(source.health).toBe('disconnected');
  });
});

describe('SourceRegistry', () => {
  it('starts empty', () => {
    const r = new SourceRegistry();
    expect(r.list()).toEqual([]);
  });

  it('add() / get() / list() / remove()', () => {
    const r = new SourceRegistry();
    const fakeSource = new MCPSource('fs', 'FS', new FakeClient() as unknown as Client);
    r.add(fakeSource);
    expect(r.list()).toHaveLength(1);
    expect(r.get('fs')).toBe(fakeSource);
    r.remove('fs');
    expect(r.list()).toEqual([]);
  });

  it('add() rejects duplicate ids', () => {
    const r = new SourceRegistry();
    r.add(new MCPSource('fs', 'FS', new FakeClient() as unknown as Client));
    expect(() =>
      r.add(new MCPSource('fs', 'Other', new FakeClient() as unknown as Client))
    ).toThrow(/already registered/);
  });

  it('closeAll() closes every registered source', async () => {
    const r = new SourceRegistry();
    const a = new MCPSource('a', 'A', new FakeClient() as unknown as Client);
    const b = new MCPSource('b', 'B', new FakeClient() as unknown as Client);
    r.add(a);
    r.add(b);
    await r.closeAll();
    expect(a.health).toBe('disconnected');
    expect(b.health).toBe('disconnected');
    expect(r.list()).toEqual([]);
  });
});

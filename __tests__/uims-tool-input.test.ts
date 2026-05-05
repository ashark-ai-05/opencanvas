import { describe, it, expect } from 'vitest';
import { providerEventsToUIMS } from '../src/backend/uims-stream.js';
import type { ProviderEvent } from '../src/core/provider.js';

async function collect(events: ProviderEvent[]): Promise<string[]> {
  async function* gen() {
    for (const e of events) yield e;
  }
  const out: string[] = [];
  for await (const line of providerEventsToUIMS(gen())) out.push(line);
  return out;
}

function parseChunks(lines: string[]): Array<Record<string, unknown>> {
  return lines
    .map((l) => l.replace(/^data: /, '').replace(/\n\n$/, ''))
    .filter((s) => s !== '[DONE]')
    .map((s) => JSON.parse(s));
}

describe('UIMS tool-input forwarding', () => {
  it('forwards tool-input as tool-input-start + tool-input-available', async () => {
    const lines = await collect([
      {
        type: 'tool-input',
        id: 'tc-1',
        name: 'search_kb',
        input: { query: 'auth' },
      },
      { type: 'done' },
    ]);
    const json = parseChunks(lines);

    const toolStart = json.find((j) => j.type === 'tool-input-start');
    expect(toolStart).toEqual({
      type: 'tool-input-start',
      toolCallId: 'tc-1',
      toolName: 'search_kb',
    });

    const toolInput = json.find((j) => j.type === 'tool-input-available');
    expect(toolInput).toEqual({
      type: 'tool-input-available',
      toolCallId: 'tc-1',
      toolName: 'search_kb',
      input: { query: 'auth' },
    });
  });

  it('keeps text bracket open across an interleaved tool-input', async () => {
    const lines = await collect([
      { type: 'text-delta', text: 'thinking' },
      {
        type: 'tool-input',
        id: 'tc-2',
        name: 'search_kb',
        input: { query: 'x' },
      },
      { type: 'text-delta', text: ' more' },
      { type: 'done' },
    ]);
    const json = parseChunks(lines);

    // Text should be a single bracket: one text-start, two text-delta, one text-end
    expect(json.filter((j) => j.type === 'text-start')).toHaveLength(1);
    expect(json.filter((j) => j.type === 'text-delta')).toHaveLength(2);
    expect(json.filter((j) => j.type === 'text-end')).toHaveLength(1);

    // Order: text-start, text-delta, tool-input-*, text-delta, text-end
    const types = json.map((j) => j.type);
    const startIdx = types.indexOf('text-start');
    const endIdx = types.indexOf('text-end');
    const toolIdx = types.indexOf('tool-input-available');
    expect(startIdx).toBeLessThan(toolIdx);
    expect(toolIdx).toBeLessThan(endIdx);
  });

  it('preserves complex input objects without coercing to string', async () => {
    const input = { query: 'a', filters: { kind: ['code', 'doc'] }, limit: 5 };
    const lines = await collect([
      { type: 'tool-input', id: 'tc-3', name: 'search_kb', input },
      { type: 'done' },
    ]);
    const toolInput = parseChunks(lines).find((j) => j.type === 'tool-input-available');
    expect(toolInput?.input).toEqual(input);
  });

  it('does not surface session-started to the wire (UIMS swallows it)', async () => {
    const lines = await collect([
      { type: 'session-started', sessionId: 'sess-1' },
      { type: 'text-delta', text: 'hi' },
      { type: 'done' },
    ]);
    const json = parseChunks(lines);
    expect(json.find((j) => j.type === 'session-started')).toBeUndefined();
    expect(json.find((j) => j.type === 'text-delta')).toBeDefined();
  });
});

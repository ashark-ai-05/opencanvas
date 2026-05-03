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

describe('UIMS tool-output forwarding', () => {
  it('forwards a successful tool-result as tool-output-available', async () => {
    const lines = await collect([
      {
        type: 'tool-result',
        toolCallId: 'tc-1',
        name: 'search_kb',
        output: { results: [{ id: 'a', kind: 'doc', title: 't' }] },
      },
      { type: 'done' },
    ]);
    const out = parseChunks(lines);
    const toolOutput = out.find((j) => j.type === 'tool-output-available');
    expect(toolOutput).toEqual({
      type: 'tool-output-available',
      toolCallId: 'tc-1',
      output: { results: [{ id: 'a', kind: 'doc', title: 't' }] },
    });
  });

  it('forwards an isError tool-result with string output as tool-output-error', async () => {
    const lines = await collect([
      {
        type: 'tool-result',
        toolCallId: 'tc-2',
        name: 'place_widget',
        output: 'Invalid payload for kind=markdown',
        isError: true,
      },
      { type: 'done' },
    ]);
    const out = parseChunks(lines);
    const toolErr = out.find((j) => j.type === 'tool-output-error');
    expect(toolErr).toEqual({
      type: 'tool-output-error',
      toolCallId: 'tc-2',
      errorText: 'Invalid payload for kind=markdown',
    });
  });

  it('stringifies non-string output when isError is true', async () => {
    const lines = await collect([
      {
        type: 'tool-result',
        toolCallId: 'tc-3',
        name: 'place_widget',
        output: { code: 'INVALID', detail: 'nope' },
        isError: true,
      },
      { type: 'done' },
    ]);
    const toolErr = parseChunks(lines).find((j) => j.type === 'tool-output-error');
    expect(toolErr).toEqual({
      type: 'tool-output-error',
      toolCallId: 'tc-3',
      errorText: '{"code":"INVALID","detail":"nope"}',
    });
  });

  it('keeps text bracket open across an interleaved tool-result', async () => {
    const lines = await collect([
      { type: 'text-delta', text: 'searching' },
      {
        type: 'tool-result',
        toolCallId: 'tc-4',
        name: 'search_kb',
        output: { results: [] },
      },
      { type: 'text-delta', text: ' done' },
      { type: 'done' },
    ]);
    const json = parseChunks(lines);
    expect(json.filter((j) => j.type === 'text-start')).toHaveLength(1);
    expect(json.filter((j) => j.type === 'text-end')).toHaveLength(1);
    const types = json.map((j) => j.type);
    const startIdx = types.indexOf('text-start');
    const endIdx = types.indexOf('text-end');
    const toolIdx = types.indexOf('tool-output-available');
    expect(startIdx).toBeLessThan(toolIdx);
    expect(toolIdx).toBeLessThan(endIdx);
  });
});

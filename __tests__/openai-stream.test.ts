import { describe, it, expect } from 'vitest';
import { providerEventsToOpenAI } from '../src/backend/openai-stream.js';
import type { ProviderEvent } from '../src/core/provider.js';

async function* gen(events: ProviderEvent[]): AsyncIterable<ProviderEvent> {
  for (const e of events) yield e;
}

async function collect(iter: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const x of iter) out.push(x);
  return out;
}

describe('providerEventsToOpenAI', () => {
  it('emits a role-assistant opener, text deltas, finish, and [DONE]', async () => {
    const out = await collect(
      providerEventsToOpenAI(gen([
        { type: 'text-delta', text: 'Hello' },
        { type: 'text-delta', text: ' world' },
        { type: 'done' },
      ]))
    );

    // Each line is a complete `data: ...\n\n` SSE block
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out[0]).toMatch(/"role":\s*"assistant"/);
    expect(out[0]).toMatch(/"delta":\s*\{[^}]*"role":\s*"assistant"/);

    const concatenated = out.join('');
    expect(concatenated).toContain('"content":"Hello"');
    expect(concatenated).toContain('"content":" world"');
    expect(concatenated).toContain('"finish_reason":"stop"');
    expect(concatenated.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('uses a stable id across all chunks of one stream', async () => {
    const out = await collect(
      providerEventsToOpenAI(gen([
        { type: 'text-delta', text: 'a' },
        { type: 'text-delta', text: 'b' },
        { type: 'done' },
      ]))
    );

    const ids = out
      .filter((line) => line.startsWith('data: {'))
      .map((line) => JSON.parse(line.slice(6)) as { id: string })
      .map((j) => j.id);

    expect(ids.length).toBeGreaterThan(0);
    const unique = new Set(ids);
    expect(unique.size).toBe(1);
  });

  it('ignores reasoning-delta, tool-input, tool-result, session-started events', async () => {
    const out = await collect(
      providerEventsToOpenAI(gen([
        { type: 'reasoning-delta', text: 'thinking…' },
        { type: 'tool-input', id: 'tc-1', name: 'foo', input: {} },
        { type: 'tool-result', id: 'tc-1', name: 'foo', output: 'bar' },
        { type: 'session-started', sessionId: 'sess-1' },
        { type: 'text-delta', text: 'final' },
        { type: 'done' },
      ]))
    );

    const concatenated = out.join('');
    expect(concatenated).toContain('"content":"final"');
    expect(concatenated).not.toContain('thinking');
    expect(concatenated).not.toContain('tool_call');
    expect(concatenated).not.toContain('sess-1');
  });

  it('handles empty stream (no text-delta) gracefully', async () => {
    const out = await collect(
      providerEventsToOpenAI(gen([{ type: 'done' }]))
    );
    // Still emits the role opener + finish + [DONE]
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out.join('')).toContain('"finish_reason":"stop"');
  });
});

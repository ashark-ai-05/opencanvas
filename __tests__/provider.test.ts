/**
 * Tests for the LLMProvider interface contract using a FakeProvider.
 *
 * These tests verify that:
 *   - Consumers can iterate all ProviderEvent types
 *   - The interface is structurally correct
 *   - Both 'model' and 'agent' kinds work the same way at the consumer level
 */
import { describe, it, expect } from 'vitest';
import type { LLMProvider, ProviderEvent, QueryRequest, ProbeResult } from '../src/core/provider.js';

// ---------------------------------------------------------------------------
// FakeProvider — a fully-typed in-memory provider for testing consumers
// ---------------------------------------------------------------------------

class FakeProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: 'model' | 'agent';
  private readonly events: ProviderEvent[];
  private readonly probeResult: ProbeResult;

  constructor(
    id: string,
    kind: 'model' | 'agent',
    events: ProviderEvent[],
    probeResult: ProbeResult = { ok: true, latencyMs: 1 },
  ) {
    this.id = id;
    this.name = `Fake(${id})`;
    this.kind = kind;
    this.events = events;
    this.probeResult = probeResult;
  }

  async *query(_request: QueryRequest): AsyncIterable<ProviderEvent> {
    for (const event of this.events) {
      yield event;
    }
  }

  async probe(): Promise<ProbeResult> {
    return this.probeResult;
  }
}

// ---------------------------------------------------------------------------
// Helper to collect all events from a provider
// ---------------------------------------------------------------------------

async function collectEvents(provider: LLMProvider, prompt = 'test'): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of provider.query({ prompt })) {
    events.push(event);
  }
  return events;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FakeProvider — model kind', () => {
  it('emits text-delta events', async () => {
    const provider = new FakeProvider('fake-model', 'model', [
      { type: 'text-delta', text: 'Hello' },
      { type: 'text-delta', text: ' world' },
      { type: 'done' },
    ]);
    const events = await collectEvents(provider);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: 'text-delta', text: 'Hello' });
    expect(events[1]).toEqual({ type: 'text-delta', text: ' world' });
    expect(events[2]).toEqual({ type: 'done' });
  });

  it('emits thinking-delta events', async () => {
    const provider = new FakeProvider('fake-model', 'model', [
      { type: 'thinking-delta', text: 'Let me think...' },
      { type: 'text-delta', text: 'Answer' },
      { type: 'done', usage: { inputTokens: 10, outputTokens: 5 } },
    ]);
    const events = await collectEvents(provider);
    expect(events[0]).toEqual({ type: 'thinking-delta', text: 'Let me think...' });
    expect(events[1]).toEqual({ type: 'text-delta', text: 'Answer' });
    expect(events[2]).toMatchObject({ type: 'done', usage: { inputTokens: 10, outputTokens: 5 } });
  });

  it('emits error events', async () => {
    const provider = new FakeProvider('fake-model', 'model', [
      { type: 'error', message: 'Something went wrong' },
      { type: 'done' },
    ]);
    const events = await collectEvents(provider);
    expect(events[0]).toEqual({ type: 'error', message: 'Something went wrong' });
  });

  it('probe returns ok result', async () => {
    const provider = new FakeProvider('fake-model', 'model', [], {
      ok: true,
      latencyMs: 42,
    });
    const result = await provider.probe();
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBe(42);
  });

  it('probe returns failure result', async () => {
    const provider = new FakeProvider('fake-model', 'model', [], {
      ok: false,
      error: 'API key not set',
    });
    const result = await provider.probe();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('API key not set');
  });
});

describe('FakeProvider — agent kind', () => {
  it('emits tool-call and tool-result events', async () => {
    const provider = new FakeProvider('fake-agent', 'agent', [
      { type: 'tool-call', name: 'read_file', input: { path: '/tmp/test.txt' } },
      { type: 'tool-result', name: 'read_file', output: 'file contents' },
      { type: 'text-delta', text: 'Based on the file...' },
      { type: 'done' },
    ]);
    const events = await collectEvents(provider);
    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ type: 'tool-call', name: 'read_file' });
    expect(events[1]).toMatchObject({ type: 'tool-result', name: 'read_file' });
  });

  it('has kind=agent', () => {
    const provider = new FakeProvider('fake-agent', 'agent', []);
    expect(provider.kind).toBe('agent');
  });
});

describe('LLMProvider interface — systemPrompt passthrough', () => {
  it('passes systemPrompt in QueryRequest', async () => {
    const received: QueryRequest[] = [];
    const provider: LLMProvider = {
      id: 'capture',
      name: 'Capture',
      kind: 'model',
      async *query(request: QueryRequest) {
        received.push(request);
        yield { type: 'done' as const };
      },
      async probe() {
        return { ok: true };
      },
    };
    for await (const _ of provider.query({ prompt: 'hi', systemPrompt: 'be brief' })) {
      // consume
    }
    expect(received[0]).toEqual({ prompt: 'hi', systemPrompt: 'be brief' });
  });
});

describe('ProviderEvent — all event types are structurally complete', () => {
  it('all event type strings are covered', () => {
    const events: ProviderEvent[] = [
      { type: 'text-delta', text: 'a' },
      { type: 'thinking-delta', text: 'b' },
      { type: 'tool-call', name: 't', input: {} },
      { type: 'tool-result', name: 't', output: null },
      { type: 'error', message: 'oops' },
      { type: 'done' },
      { type: 'done', usage: { inputTokens: 1, outputTokens: 2 } },
    ];
    const types = events.map((e) => e.type);
    expect(types).toContain('text-delta');
    expect(types).toContain('thinking-delta');
    expect(types).toContain('tool-call');
    expect(types).toContain('tool-result');
    expect(types).toContain('error');
    expect(types).toContain('done');
  });
});

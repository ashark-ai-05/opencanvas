import { describe, it, expect } from 'vitest';
import type { QueryRequest, ProviderEvent } from '../src/core/provider.js';
import type { CanvasSnapshot } from '../src/agent/canvas-snapshot.js';

describe('provider type extensions', () => {
  it('QueryRequest accepts canvasSnapshot and abortSignal', () => {
    const ac = new AbortController();
    const snap: CanvasSnapshot = {
      activeTemplateId: 'ask-anything',
      widgets: [],
    };
    const r: QueryRequest = {
      prompt: 'hi',
      canvasSnapshot: snap,
      abortSignal: ac.signal,
    };
    expect(r.canvasSnapshot?.widgets).toHaveLength(0);
    expect(r.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it('QueryRequest accepts history, sessionId, rawPrompt', () => {
    const r: QueryRequest = {
      prompt: 'hi',
      history: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      sessionId: 'sess-123',
      rawPrompt: true,
    };
    expect(r.history).toHaveLength(2);
    expect(r.sessionId).toBe('sess-123');
    expect(r.rawPrompt).toBe(true);
  });

  it('tool-input ProviderEvent carries id', () => {
    const e: ProviderEvent = {
      type: 'tool-input',
      id: 'tc-1',
      name: 'search_kb',
      input: { query: 'auth' },
    };
    if (e.type === 'tool-input') {
      expect(e.id).toBe('tc-1');
    }
  });

  it('tool-result ProviderEvent carries id and optional isError', () => {
    const ok: ProviderEvent = {
      type: 'tool-result',
      id: 'tc-1',
      name: 'search_kb',
      output: { results: [] },
    };
    const err: ProviderEvent = {
      type: 'tool-result',
      id: 'tc-2',
      name: 'place_widget',
      output: 'invalid payload',
      isError: true,
    };
    if (ok.type === 'tool-result') expect(ok.id).toBe('tc-1');
    if (err.type === 'tool-result') expect(err.isError).toBe(true);
  });

  it('session-started ProviderEvent carries sessionId', () => {
    const e: ProviderEvent = { type: 'session-started', sessionId: 'sess-1' };
    if (e.type === 'session-started') {
      expect(e.sessionId).toBe('sess-1');
    }
  });
});

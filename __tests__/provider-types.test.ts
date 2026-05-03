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

  it('tool-call ProviderEvent carries toolCallId', () => {
    const e: ProviderEvent = {
      type: 'tool-call',
      toolCallId: 'tc-1',
      name: 'search_kb',
      input: { query: 'auth' },
    };
    if (e.type === 'tool-call') {
      expect(e.toolCallId).toBe('tc-1');
    }
  });

  it('tool-result ProviderEvent carries toolCallId and optional isError', () => {
    const ok: ProviderEvent = {
      type: 'tool-result',
      toolCallId: 'tc-1',
      name: 'search_kb',
      output: { results: [] },
    };
    const err: ProviderEvent = {
      type: 'tool-result',
      toolCallId: 'tc-2',
      name: 'place_widget',
      output: 'invalid payload',
      isError: true,
    };
    if (ok.type === 'tool-result') expect(ok.toolCallId).toBe('tc-1');
    if (err.type === 'tool-result') expect(err.isError).toBe(true);
  });
});

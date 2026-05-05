import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const actual = await vi.importActual<
    typeof import('@anthropic-ai/claude-agent-sdk')
  >('@anthropic-ai/claude-agent-sdk');
  return {
    ...actual,
    query: vi.fn().mockImplementation(() => {
      return (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          uuid: 'r-1',
          session_id: 's-1',
          duration_ms: 0,
          duration_api_ms: 0,
          is_error: false,
          num_turns: 1,
          result: '',
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      })();
    }),
  };
});

import { ClaudeAgentSdkAdapter } from '../src/providers/claude-agent-sdk.js';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { CanvasSnapshot } from '../src/agent/canvas-snapshot.js';

const mockedQuery = sdkQuery as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockedQuery.mockClear();
});

describe('claude-agent-sdk options', () => {
  it('passes maxTurns, maxOutputTokens, effort, thinking.display', async () => {
    const adapter = new ClaudeAgentSdkAdapter();
    const snap: CanvasSnapshot = {
      activeTemplateId: 'ask-anything',
      widgets: [],
    };
    for await (const _ of adapter.query({
      prompt: 'hi',
      canvasSnapshot: snap,
    })) {
      void _;
    }
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    const opts = (
      mockedQuery.mock.calls[0]![0] as { options: Record<string, unknown> }
    ).options;
    expect(opts.maxTurns).toBe(20);
    expect(opts.maxOutputTokens).toBe(8192);
    expect(opts.effort).toBe('medium');
    expect((opts.thinking as { display?: string }).display).toBe('summarized');
  });

  it('forwards abortSignal — external abort propagates to SDK abortController', async () => {
    const adapter = new ClaudeAgentSdkAdapter();
    const ac = new AbortController();
    for await (const _ of adapter.query({
      prompt: 'hi',
      canvasSnapshot: { activeTemplateId: 'ask-anything', widgets: [] },
      abortSignal: ac.signal,
    })) {
      void _;
    }
    const opts = (
      mockedQuery.mock.calls[0]![0] as { options: Record<string, unknown> }
    ).options;
    expect(opts.abortController).toBeInstanceOf(AbortController);
    ac.abort();
    expect((opts.abortController as AbortController).signal.aborted).toBe(true);
  });

  it('wires the 11 agent tools as MCP server with allowedTools mcp__opencanvas__*', async () => {
    const adapter = new ClaudeAgentSdkAdapter();
    for await (const _ of adapter.query({
      prompt: 'hi',
      canvasSnapshot: { activeTemplateId: 'ask-anything', widgets: [] },
    })) {
      void _;
    }
    const opts = (
      mockedQuery.mock.calls[0]![0] as { options: Record<string, unknown> }
    ).options;
    const allowed = opts.allowedTools as string[];
    expect(allowed.length).toBe(11);
    expect(allowed.every((t) => t.startsWith('mcp__opencanvas__'))).toBe(true);
    // Sanity: known tool names appear
    expect(allowed).toContain('mcp__opencanvas__search_kb');
    expect(allowed).toContain('mcp__opencanvas__web_search');
    expect(allowed).toContain('mcp__opencanvas__place_widget');
    expect(allowed).toContain('mcp__opencanvas__update_widget');
    expect(opts.mcpServers).toBeDefined();
    expect(
      (opts.mcpServers as Record<string, unknown>)['opencanvas'],
    ).toBeDefined();
  });

  it('falls back to a stub search adapter when no deps.search is provided', async () => {
    const adapter = new ClaudeAgentSdkAdapter();
    // Just confirm the adapter constructs and runs without throwing.
    const events: unknown[] = [];
    for await (const e of adapter.query({
      prompt: 'hi',
      canvasSnapshot: { activeTemplateId: 'ask-anything', widgets: [] },
    })) {
      events.push(e);
    }
    expect(events.length).toBeGreaterThan(0);
  });
});

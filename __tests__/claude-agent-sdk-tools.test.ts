import { describe, it, expect } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  ClaudeAgentSdkAdapter,
  mapMessageForTesting,
} from '../src/providers/claude-agent-sdk.js';
import type { ProviderEvent } from '../src/core/provider.js';

describe('claude-agent-sdk adapter — tool event mapping', () => {
  it('maps assistant tool_use block to a tool-call ProviderEvent with toolCallId', () => {
    const msg = {
      type: 'assistant',
      uuid: 'u-1',
      session_id: 's-1',
      message: {
        id: 'msg-1',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-7',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_abc',
            name: 'search_kb',
            input: { query: 'auth' },
          },
        ],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    } as unknown as SDKMessage;

    const events = mapMessageForTesting(msg);
    const call = events.find(
      (e: ProviderEvent) => e.type === 'tool-call',
    ) as Extract<ProviderEvent, { type: 'tool-call' }>;
    expect(call).toBeDefined();
    expect(call.toolCallId).toBe('toolu_abc');
    expect(call.name).toBe('search_kb');
    expect(call.input).toEqual({ query: 'auth' });
  });

  it('maps user tool_result message with string content to a tool-result event', () => {
    const msg = {
      type: 'user',
      uuid: 'u-2',
      session_id: 's-1',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_abc',
            content: '{"results":[]}',
          },
        ],
      },
    } as unknown as SDKMessage;

    const events = mapMessageForTesting(msg);
    const result = events.find(
      (e: ProviderEvent) => e.type === 'tool-result',
    ) as Extract<ProviderEvent, { type: 'tool-result' }>;
    expect(result).toBeDefined();
    expect(result.toolCallId).toBe('toolu_abc');
    expect(result.output).toBe('{"results":[]}');
    expect(result.isError).toBe(false);
  });

  it('maps user tool_result with is_error:true to tool-result with isError:true', () => {
    const msg = {
      type: 'user',
      uuid: 'u-3',
      session_id: 's-1',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_xyz',
            content: 'Invalid payload',
            is_error: true,
          },
        ],
      },
    } as unknown as SDKMessage;

    const events = mapMessageForTesting(msg);
    const result = events.find(
      (e: ProviderEvent) => e.type === 'tool-result',
    ) as Extract<ProviderEvent, { type: 'tool-result' }>;
    expect(result).toBeDefined();
    expect(result.toolCallId).toBe('toolu_xyz');
    expect(result.isError).toBe(true);
  });

  it('maps user tool_result with array content (text blocks) by joining text', () => {
    const msg = {
      type: 'user',
      uuid: 'u-4',
      session_id: 's-1',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_arr',
            content: [
              { type: 'text', text: 'hello ' },
              { type: 'text', text: 'world' },
            ],
          },
        ],
      },
    } as unknown as SDKMessage;

    const result = mapMessageForTesting(msg).find(
      (e) => e.type === 'tool-result',
    ) as Extract<ProviderEvent, { type: 'tool-result' }>;
    expect(result.output).toBe('hello world');
  });

  it('exposes adapter id and kind unchanged', () => {
    const a = new ClaudeAgentSdkAdapter();
    expect(a.id).toBe('claude-agent-sdk');
    expect(a.kind).toBe('agent');
  });
});

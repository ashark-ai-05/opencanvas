import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveChatHistory,
  loadChatHistory,
  clearChatHistory,
  collectAppliedToolCallIds,
} from '../../app/src/components/chat-persistence';
import type { UIMessage } from 'ai';

beforeEach(() => {
  localStorage.clear();
});

describe('chat-persistence', () => {
  it('round-trips messages through localStorage', () => {
    const messages: UIMessage[] = [
      { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hello' }] } as never,
    ];
    saveChatHistory(messages);
    expect(loadChatHistory()).toEqual(messages);
  });

  it('returns [] when nothing is stored', () => {
    expect(loadChatHistory()).toEqual([]);
  });

  it('returns [] for malformed payloads (corrupted localStorage)', () => {
    localStorage.setItem('opencanvas:chat-history:default', 'not-json');
    expect(loadChatHistory()).toEqual([]);
  });

  it('returns [] for non-array payloads (key collision)', () => {
    localStorage.setItem('opencanvas:chat-history:default', '{"oops":true}');
    expect(loadChatHistory()).toEqual([]);
  });

  it('saving an empty array clears the storage key (no stale stub)', () => {
    saveChatHistory([{ id: 'm', role: 'user', parts: [] } as never]);
    expect(localStorage.getItem('opencanvas:chat-history:default')).toBeTruthy();
    saveChatHistory([]);
    expect(localStorage.getItem('opencanvas:chat-history:default')).toBeNull();
  });

  it('clearChatHistory removes the key', () => {
    saveChatHistory([{ id: 'm', role: 'user', parts: [] } as never]);
    clearChatHistory();
    expect(localStorage.getItem('opencanvas:chat-history:default')).toBeNull();
  });

  it('collectAppliedToolCallIds finds tool-output-available across all messages', () => {
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'hi' },
          { type: 'tool-mcp__opencanvas__place_widget', state: 'output-available', toolCallId: 'tc-1' },
          { type: 'tool-mcp__opencanvas__search_kb', state: 'input-available', toolCallId: 'tc-skip' },
        ],
      },
      {
        id: 'm2',
        role: 'assistant',
        parts: [
          { type: 'dynamic-tool', state: 'output-available', toolCallId: 'tc-2' },
        ],
      },
    ] as unknown as UIMessage[];
    expect(collectAppliedToolCallIds(messages)).toEqual(['tc-1', 'tc-2']);
  });

  it('collectAppliedToolCallIds skips parts without a toolCallId', () => {
    const messages = [
      {
        id: 'm1',
        role: 'assistant',
        parts: [
          { type: 'tool-foo', state: 'output-available' /* no toolCallId */ },
        ],
      },
    ] as unknown as UIMessage[];
    expect(collectAppliedToolCallIds(messages)).toEqual([]);
  });
});

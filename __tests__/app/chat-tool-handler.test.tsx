import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Mock the dispatcher module BEFORE importing Chat (Vitest handles hoisting).
// Use vi.hoisted so mocks are available inside the hoisted vi.mock factory.
const { applyMock } = vi.hoisted(() => ({ applyMock: vi.fn() }));
vi.mock('../../app/src/canvas/dispatcher', () => ({
  applyToolDirective: applyMock,
  placeResultsOnCanvas: vi.fn(),
}));

// Provide a fake editor via the singleton.
import { setEditor } from '../../app/src/state/editor-ref';

// Mock useChat to inject a controlled messages array.
const { messagesRef } = vi.hoisted(() => ({
  messagesRef: {
    current: [] as Array<{ id: string; role: string; parts: unknown[] }>,
  },
}));
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: messagesRef.current,
    sendMessage: vi.fn(),
    status: 'ready' as const,
  }),
}));

import { Chat } from '../../app/src/components/Chat';

beforeEach(() => {
  applyMock.mockClear();
  messagesRef.current = [];
  setEditor({} as never); // any non-null sentinel — applyToolDirective is mocked
  cleanup();
});

// AI SDK 6 surfaces tool parts as:
//   { type: 'tool-<NAME>' | 'dynamic-tool',
//     state: 'input-available' | 'output-available' | 'output-error' | 'input-streaming',
//     toolCallId, input?, output?, errorText? }
// These tests use the real shape, NOT the wire-level UIMS chunk shape.

describe('Chat tool handler', () => {
  it('dispatches a place directive on tool-<name> output-available with .directive object', () => {
    messagesRef.current = [
      {
        id: 'm-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__opencanvas__place_widget',
            state: 'output-available',
            toolCallId: 'tc-1',
            input: { kind: 'markdown', role: 'primary', payload: {} },
            output: {
              ok: true,
              id: 'w-1',
              directive: {
                type: 'place',
                id: 'w-1',
                kind: 'markdown',
                role: 'primary',
                payload: { title: 't', body: 'b' },
              },
            },
          },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0]![1].type).toBe('place');
  });

  it('parses string output (real MCP wire shape) and dispatches', () => {
    const directive = {
      type: 'place',
      id: 'w-2',
      kind: 'markdown',
      role: 'detail',
      payload: { title: 't', body: 'b' },
    };
    messagesRef.current = [
      {
        id: 'm-2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__opencanvas__place_widget',
            state: 'output-available',
            toolCallId: 'tc-2',
            input: {},
            output: JSON.stringify({ ok: true, id: 'w-2', directive }),
          },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0]![1]).toMatchObject(directive);
  });

  it('also dispatches for dynamic-tool parts (MCP-loaded, alternate SDK shape)', () => {
    messagesRef.current = [
      {
        id: 'm-dyn',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'mcp__opencanvas__place_widget',
            state: 'output-available',
            toolCallId: 'tc-dyn',
            input: {},
            output: {
              directive: {
                type: 'place',
                id: 'w-dyn',
                kind: 'markdown',
                role: 'primary',
                payload: { title: 't', body: 'b' },
              },
            },
          },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).toHaveBeenCalledTimes(1);
  });

  it('does not double-apply on re-render', () => {
    messagesRef.current = [
      {
        id: 'm-3',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__opencanvas__place_widget',
            state: 'output-available',
            toolCallId: 'tc-3',
            input: {},
            output: {
              directive: {
                type: 'place',
                id: 'w-3',
                kind: 'markdown',
                role: 'primary',
                payload: { title: 't', body: 'b' },
              },
            },
          },
        ],
      },
    ];
    const { rerender } = render(<Chat />);
    rerender(<Chat />);
    expect(applyMock).toHaveBeenCalledTimes(1);
  });

  it('skips parts that are not tool parts at all', () => {
    messagesRef.current = [
      {
        id: 'm-4',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'hello' },
          { type: 'reasoning', text: 'thinking' },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('skips tool parts in non-output-available states (input-available, etc.)', () => {
    messagesRef.current = [
      {
        id: 'm-input',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__opencanvas__place_widget',
            state: 'input-available',
            toolCallId: 'tc-input',
            input: { kind: 'markdown' },
          },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('silently skips malformed string output (not a directive)', () => {
    messagesRef.current = [
      {
        id: 'm-5',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__opencanvas__place_widget',
            state: 'output-available',
            toolCallId: 'tc-5',
            input: {},
            output: 'not json',
          },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('skips tool output without a .directive field (e.g., search_kb result)', () => {
    messagesRef.current = [
      {
        id: 'm-6',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__opencanvas__search_kb',
            state: 'output-available',
            toolCallId: 'tc-6',
            input: { query: 'a' },
            output: { results: [{ id: 'a', kind: 'doc', title: 't' }] },
          },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it('does not dispatch when no editor is registered', () => {
    setEditor(null);
    messagesRef.current = [
      {
        id: 'm-7',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__opencanvas__place_widget',
            state: 'output-available',
            toolCallId: 'tc-7',
            input: {},
            output: {
              directive: { type: 'place', id: 'x', kind: 'markdown', role: 'primary', payload: {} },
            },
          },
        ],
      },
    ];
    render(<Chat />);
    expect(applyMock).not.toHaveBeenCalled();
  });
});

describe('Chat tool indicators', () => {
  it('renders "calling <toolName>…" for tool-<name> parts in input-available state', () => {
    messagesRef.current = [
      {
        id: 'm-call',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__opencanvas__search_kb',
            state: 'input-available',
            toolCallId: 'tc-call',
            input: { query: 'auth' },
          },
        ],
      },
    ];
    const { container } = render(<Chat />);
    // toolPartName strips 'tool-' and 'mcp__<server>__' → 'search_kb'.
    // The label and tool name render in separate spans so we check
    // container.textContent which concatenates child text.
    expect(container.textContent).toMatch(/calling/i);
    expect(container.textContent).toMatch(/search_kb/);
  });

  it('renders "tool error" for tool parts in output-error state', () => {
    messagesRef.current = [
      {
        id: 'm-err',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__opencanvas__place_widget',
            state: 'output-error',
            toolCallId: 'tc-err',
            input: {},
            errorText: 'Invalid payload for kind=markdown',
          },
        ],
      },
    ];
    const { container } = render(<Chat />);
    expect(container.textContent).toMatch(/tool error/i);
    expect(container.textContent).toMatch(/place_widget/);
    expect(container.textContent).toMatch(/Invalid payload for kind=markdown/);
  });

  it('renders nothing visible for output-available (directive applied silently)', () => {
    messagesRef.current = [
      {
        id: 'm-out',
        role: 'assistant',
        parts: [
          {
            type: 'tool-mcp__opencanvas__place_widget',
            state: 'output-available',
            toolCallId: 'tc-out',
            input: {},
            output: {
              directive: { type: 'place', id: 'w', kind: 'markdown', role: 'primary', payload: {} },
            },
          },
        ],
      },
    ];
    const { container } = render(<Chat />);
    expect(container.textContent).not.toMatch(/calling/i);
    expect(container.textContent).not.toMatch(/tool error/i);
  });

  it('renders text parts alongside tool indicators', () => {
    messagesRef.current = [
      {
        id: 'm-mixed',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Looking that up.' },
          {
            type: 'tool-mcp__opencanvas__fetch_result',
            state: 'input-available',
            toolCallId: 'tc-x',
            input: { id: 'x' },
          },
          { type: 'text', text: ' Here it is.' },
        ],
      },
    ];
    const { container } = render(<Chat />);
    expect(container.textContent).toMatch(/Looking that up\./);
    expect(container.textContent).toMatch(/calling/i);
    expect(container.textContent).toMatch(/fetch_result/);
    expect(container.textContent).toMatch(/Here it is\./);
  });

  it('renders dynamic-tool input-available with toolName field', () => {
    messagesRef.current = [
      {
        id: 'm-dyn-ind',
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            toolName: 'whatever_dynamic',
            state: 'input-available',
            toolCallId: 'tc-dyn-ind',
            input: {},
          },
        ],
      },
    ];
    const { container } = render(<Chat />);
    expect(container.textContent).toMatch(/calling/i);
    expect(container.textContent).toMatch(/whatever_dynamic/);
  });
});

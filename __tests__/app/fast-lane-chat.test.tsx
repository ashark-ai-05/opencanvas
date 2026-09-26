import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// Vitest hoists vi.mock() calls above their surrounding scope, so mocked
// values referenced inside a factory must come from vi.hoisted() (plain
// top-level `const`s referenced in a factory throw at transform time on
// this vitest version — see the codebase convention in
// chat-tool-handler.test.tsx).
const { sendMessage, setMessages } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  setMessages: vi.fn(),
}));
vi.mock('@ai-sdk/react', () => ({
  useChat: () => ({
    messages: [],
    sendMessage,
    setMessages,
    status: 'ready',
    stop: vi.fn(),
    error: undefined,
  }),
}));

const { applyToolDirective } = vi.hoisted(() => ({ applyToolDirective: vi.fn() }));
vi.mock('../../app/src/canvas/dispatcher', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../app/src/canvas/dispatcher')>();
  return { ...mod, applyToolDirective };
});

const fakeEditor = { getViewportPageBounds: () => ({ x: 0, y: 0, w: 1000, h: 800 }) };
vi.mock('../../app/src/state/editor-ref', () => ({
  getEditor: () => fakeEditor,
  setEditor: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

import { Chat } from '../../app/src/components/Chat';
import { useUserSettings } from '../../app/src/state/user-settings-store';

beforeEach(() => {
  sendMessage.mockReset();
  setMessages.mockReset();
  applyToolDirective.mockReset();
  useUserSettings.getState().reset();
  // kbSearch() fires a fetch on send; keep jsdom quiet.
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ ok: false, json: async () => ({}) } as Response),
  ) as unknown as typeof fetch;
});

async function typeAndWaitForChip(text: string) {
  const input = screen.getByPlaceholderText(/ask opencanvas anything/i) as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: text } });
  await screen.findByText(/ask model/i, {}, { timeout: 1500 });
  return input;
}

describe('fast lane in Chat', () => {
  it('Enter on a committed chip places locally and does not call the model', async () => {
    render(<Chat />);
    const input = await typeAndWaitForChip('25 min timer');
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(applyToolDirective).toHaveBeenCalledTimes(1));
    const directive = applyToolDirective.mock.calls[0][1];
    expect(directive).toMatchObject({
      type: 'place',
      kind: 'time',
      role: 'primary',
      payload: { mode: 'timer', durationSec: 1500 },
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(setMessages).toHaveBeenCalledTimes(1);
    const updater = setMessages.mock.calls[0][0] as (prev: unknown[]) => unknown[];
    const next = updater([]);
    expect(next[0]).toMatchObject({
      role: 'assistant',
      metadata: { local: 'fast-lane', originalText: '25 min timer' },
    });
    expect(input.value).toBe('');
  });

  it('Mod+Enter bypasses the fast lane and asks the model', async () => {
    render(<Chat />);
    const input = await typeAndWaitForChip('25 min timer');
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ text: '25 min timer' }));
    expect(applyToolDirective).not.toHaveBeenCalled();
  });

  it('with the setting off, Enter goes to the model', async () => {
    useUserSettings.getState().update({ fastLane: false });
    render(<Chat />);
    const input = screen.getByPlaceholderText(/ask opencanvas anything/i);
    fireEvent.change(input, { target: { value: '25 min timer' } });
    await new Promise((r) => setTimeout(r, 250));
    expect(screen.queryByText(/ask model/i)).toBeNull();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(applyToolDirective).not.toHaveBeenCalled();
  });
});

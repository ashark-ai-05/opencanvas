import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { Chat } from '../../app/src/components/Chat';
import { useTemplateStore } from '../../app/src/state/template-store';
import { setLatestSnapshot } from '../../app/src/state/snapshot-ref';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response('data: {"type":"start"}\n\ndata: [DONE]\n\n', {
      status: 200,
      headers: {
        'content-type': 'text/event-stream',
        'x-vercel-ai-ui-message-stream': 'v1',
      },
    }),
  );
  globalThis.fetch = fetchMock as never;
  useTemplateStore.setState({ activeTemplateId: 'ask-anything' });
  setLatestSnapshot({ activeTemplateId: 'ask-anything', widgets: [] });
});

describe('Chat sends canvasSnapshot', () => {
  it('includes canvasSnapshot in the request body when sending', async () => {
    const { container } = render(<Chat />);
    const input = container.querySelector(
      'textarea.opencanvas-chat-input',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hello' } });

    // The form/button to submit — find by Send icon's aria-label or fall back to form
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);

    // Chat now also fires /v1/search in parallel (KB hits panel) — filter
    // for the /v1/chat request specifically.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes('/v1/chat')),
      ).toBe(true),
    );
    const chatCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/v1/chat'),
    )!;
    const body = JSON.parse((chatCall[1] as RequestInit).body as string);
    expect(body.canvasSnapshot).toBeDefined();
    expect(body.canvasSnapshot.activeTemplateId).toBe('ask-anything');
    expect(Array.isArray(body.canvasSnapshot.widgets)).toBe(true);
  });

  it('reflects the latest snapshot in the body callback (not a stale capture)', async () => {
    const { container } = render(<Chat />);

    // Publish a richer snapshot AFTER mount but BEFORE submit
    setLatestSnapshot({
      activeTemplateId: 'tell-me-about-x',
      widgets: [
        {
          id: 'w-1',
          kind: 'markdown',
          role: 'primary',
          title: 't',
          payload: { title: 't', body: 'b' },
        },
      ],
    });

    const input = container.querySelector(
      'textarea.opencanvas-chat-input',
    ) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((c) => String(c[0]).includes('/v1/chat')),
      ).toBe(true),
    );
    const chatCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/v1/chat'),
    )!;
    const body = JSON.parse((chatCall[1] as RequestInit).body as string);
    expect(body.canvasSnapshot.activeTemplateId).toBe('tell-me-about-x');
    expect(body.canvasSnapshot.widgets).toHaveLength(1);
  });
});

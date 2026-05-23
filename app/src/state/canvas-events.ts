import { useEffect } from 'react';
import { applyToolDirective } from '../canvas/dispatcher';
import { getEditor } from './editor-ref';
import { useTemplateStore } from './template-store';
import { useConversationsStore } from './conversations-store';
import { usePluginRegistry, type PluginKindDescriptor } from './plugin-registry-store';
import type { ToolDirective } from '../../../src/agent/types';

/**
 * Subscribe to /v1/canvas/events for the currently-active conversation.
 *
 * Each event is a UIMS-style `event: directive` SSE record whose `data:`
 * line is the JSON of a single ToolDirective. We hand the directive
 * straight to applyToolDirective — same path the chat tool-output reader
 * uses, so external pushes go through the SAME dispatcher (place,
 * update, focus, clear, remove, link, switchTemplate, stream-*).
 *
 * Lifecycle:
 *   - Reopens whenever activeId changes (close old, open new).
 *   - Reopens on transient network errors with exponential backoff.
 *   - Posts the active conversationId to backend on every change so
 *     external apps can omit the field and target "the active canvas".
 */
export function useCanvasExternalEvents(): void {
  const activeId = useConversationsStore((s) => s.activeId);

  // Tell the backend which conversation is active so external POSTs
  // without an explicit conversationId route correctly. Fire-and-forget;
  // the backend stores the id in-memory.
  useEffect(() => {
    fetch('/v1/canvas/active-conversation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: activeId }),
    }).catch(() => {
      // Backend may not be ready yet on the very first paint; harmless.
    });
  }, [activeId]);

  // Open the SSE for this conversation. The cleanup closes the previous
  // connection before opening the next one when activeId switches.
  useEffect(() => {
    if (!activeId) return undefined;
    let cancelled = false;
    let attempt = 0;
    let es: EventSource | null = null;
    let reopenTimer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (cancelled) return;
      es = new EventSource(
        `/v1/canvas/events?conversationId=${encodeURIComponent(activeId)}`,
      );

      es.addEventListener('directive', (ev) => {
        const editor = getEditor();
        if (!editor) return;
        try {
          const directive = JSON.parse(
            (ev as MessageEvent).data,
          ) as ToolDirective;
          const tplId = useTemplateStore.getState().activeTemplateId;
          applyToolDirective(editor, directive, tplId);
        } catch (e) {
          console.warn('[canvas-events] bad directive', e);
        }
      });

      // Plugin registry sync. The backend ships the current registry
      // snapshot on connect (one register event per kind), then streams
      // subsequent register/unregister events. The browser cache stays
      // in lockstep without a separate poll/GET.
      es.addEventListener('widget-kind', (ev) => {
        try {
          const event = JSON.parse((ev as MessageEvent).data) as
            | { type: 'register'; descriptor: PluginKindDescriptor }
            | { type: 'unregister'; kind: string };
          const store = usePluginRegistry.getState();
          if (event.type === 'register') store.upsert(event.descriptor);
          else store.remove(event.kind);
          if (!store.hydrated) store.setHydrated(true);
        } catch (e) {
          console.warn('[canvas-events] bad widget-kind event', e);
        }
      });

      es.onopen = () => {
        attempt = 0;
      };

      es.onerror = () => {
        // EventSource auto-reconnects on its own, but only if the
        // connection drops cleanly. On hard errors (server restart,
        // 502) we close and back off manually so we don't spam.
        es?.close();
        if (cancelled) return;
        attempt += 1;
        const delay = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5));
        reopenTimer = setTimeout(open, delay);
      };
    };

    open();

    return () => {
      cancelled = true;
      es?.close();
      if (reopenTimer) clearTimeout(reopenTimer);
    };
  }, [activeId]);
}

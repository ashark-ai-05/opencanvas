import type { TLEditorSnapshot, TLShape } from 'tldraw';
import { useConversationsStore } from '../state/conversations-store';

export const CANVAS_STORAGE_KEY = 'opencanvas:canvas:default';

export function saveCanvasSnapshot(snapshot: TLEditorSnapshot): void {
  try {
    localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn('[canvas] save failed:', e);
  }
}

export function loadCanvasSnapshot(): TLEditorSnapshot | null {
  const raw = localStorage.getItem(CANVAS_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TLEditorSnapshot;
  } catch (e) {
    console.warn('[canvas] load failed:', e);
    return null;
  }
}

export function clearCanvasSnapshot(): void {
  localStorage.removeItem(CANVAS_STORAGE_KEY);
}

/**
 * Append a tldraw shape to another conversation's persisted canvas snapshot.
 *
 * Reads the target conversation's `canvasSnapshot` from the conversations store
 * (already in memory — no extra I/O), inserts the shape into `document.store`,
 * then calls `saveCanvasSnapshot` on the store so the change is persisted to
 * localStorage atomically.
 *
 * If the target conversation has no snapshot yet (never visited), we create a
 * minimal skeleton that tldraw can hydrate when the conversation is next opened.
 *
 * @param conversationId - the target conversation id
 * @param shape - the full tldraw TLShape record to insert
 */
export function appendShapeToConversation(
  conversationId: string,
  shape: TLShape,
): void {
  const state = useConversationsStore.getState();
  const target = state.conversations.find((c) => c.id === conversationId);
  if (!target) return;

  const existing = target.canvasSnapshot;

  let nextSnapshot: TLEditorSnapshot;

  if (existing && existing.document && existing.document.store) {
    // Deep-clone so we never mutate the store's in-memory reference.
    nextSnapshot = JSON.parse(JSON.stringify(existing)) as TLEditorSnapshot;
    // Insert (or overwrite) the shape record keyed by its tldraw id.
    (nextSnapshot.document.store as Record<string, unknown>)[shape.id] = shape;
  } else {
    // No snapshot yet — build a minimal one. tldraw will fill in default
    // page / camera records when the conversation is next mounted.
    nextSnapshot = {
      document: {
        store: { [shape.id]: shape } as Record<string, unknown>,
        schema: existing?.document?.schema ?? {},
      },
      session: existing?.session ?? {},
    } as unknown as TLEditorSnapshot;
  }

  state.saveCanvasSnapshot(conversationId, nextSnapshot);
}

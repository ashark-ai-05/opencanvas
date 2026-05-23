import { create } from 'zustand';

/**
 * Per-conversation canvas history. Coarse snapshots taken on a debounce
 * after every save (so a typing burst is one entry, not 30); old
 * entries trimmed on insert past `MAX_PER_CONVERSATION`.
 *
 * Storage: localStorage under one key per conversation. tldraw
 * snapshots are JSON-serialisable already (Canvas.tsx already saves
 * the live one to conversations-store), so we just stash the same
 * object with a timestamp.
 *
 * Tradeoffs vs IndexedDB: localStorage is sync (no Promise dance) and
 * its 5–10MB cap is enough for ~50 entries per conversation at
 * typical canvas sizes. We don't try to dedupe identical snapshots —
 * the debounce + tldraw's structural sharing already keeps churn low.
 */
const MAX_PER_CONVERSATION = 50;
const KEY_PREFIX = 'opencanvas:history:';

export type CanvasHistoryEntry = {
  /** Snapshot id — UUID, used as map key + animation key. */
  id: string;
  /** Wall-clock ms when the snapshot was captured. */
  ts: number;
  /** Optional human label — currently always undefined; reserved for
   *  future "name this point" UI. */
  label?: string;
  /** tldraw snapshot blob. Treat as opaque outside the canvas layer. */
  snapshot: unknown;
};

type Store = {
  /** All entries for the current process, keyed by conversationId. */
  byConversation: Record<string, CanvasHistoryEntry[]>;
  /**
   * Hydrate a conversation's history from localStorage. Idempotent —
   * called once per conversation switch.
   */
  hydrate: (conversationId: string) => void;
  /**
   * Append a new snapshot. Trims oldest entries past MAX_PER_CONVERSATION.
   */
  push: (conversationId: string, snapshot: unknown) => void;
  /** Drop everything for a conversation. */
  clear: (conversationId: string) => void;
};

function persist(conversationId: string, entries: CanvasHistoryEntry[]): void {
  try {
    localStorage.setItem(KEY_PREFIX + conversationId, JSON.stringify(entries));
  } catch {
    // Quota / private mode — silently drop. The in-memory state is
    // still valid for the current session.
  }
}

function loadFromStorage(conversationId: string): CanvasHistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY_PREFIX + conversationId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CanvasHistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export const useCanvasHistory = create<Store>((set, get) => ({
  byConversation: {},
  hydrate: (conversationId) => {
    if (get().byConversation[conversationId]) return;
    const entries = loadFromStorage(conversationId);
    set((s) => ({
      byConversation: { ...s.byConversation, [conversationId]: entries },
    }));
  },
  push: (conversationId, snapshot) => {
    const entry: CanvasHistoryEntry = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      snapshot,
    };
    set((s) => {
      const existing = s.byConversation[conversationId] ?? [];
      const next = [...existing, entry].slice(-MAX_PER_CONVERSATION);
      persist(conversationId, next);
      return {
        byConversation: { ...s.byConversation, [conversationId]: next },
      };
    });
  },
  clear: (conversationId) => {
    try {
      localStorage.removeItem(KEY_PREFIX + conversationId);
    } catch {
      /* ignore */
    }
    set((s) => {
      const { [conversationId]: _gone, ...rest } = s.byConversation;
      return { byConversation: rest };
    });
  },
}));

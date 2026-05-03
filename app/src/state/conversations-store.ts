import { create } from 'zustand';
import type { UIMessage } from 'ai';
import type { TLEditorSnapshot } from 'tldraw';

/**
 * One persisted conversation: chat messages + the canvas state at the
 * moment of the last write. Conversations are independent threads — switching
 * between them swaps both chat AND canvas atomically.
 */
export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
  canvasSnapshot?: TLEditorSnapshot;
};

const CONVERSATIONS_KEY = 'strata:conversations';
const ACTIVE_ID_KEY = 'strata:active-conversation-id';
// Pre-migration keys (single-conversation era). Read once for migration,
// then ignored.
const LEGACY_CHAT_KEY = 'strata:chat-history:default';
const LEGACY_CANVAS_KEY = 'strata:canvas:default';

type ConversationsStore = {
  conversations: Conversation[];
  activeId: string;

  createNew: () => string;
  selectOne: (id: string) => void;
  deleteOne: (id: string) => void;
  renameOne: (id: string, title: string) => void;

  // Patches for the active conversation — wired from Chat + Canvas.
  saveMessages: (id: string, messages: UIMessage[]) => void;
  saveCanvasSnapshot: (id: string, snapshot: TLEditorSnapshot) => void;

  // Helpers.
  getActive: () => Conversation;
};

function newId(): string {
  return `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function emptyConversation(): Conversation {
  const now = Date.now();
  return {
    id: newId(),
    title: 'New chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

/**
 * Pull the first user message's text and use it as a conversation title.
 * Truncates so titles stay sidebar-sized. Returns null if no user text yet.
 */
function deriveTitle(messages: UIMessage[]): string | null {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    for (const p of m.parts as Array<{ type: string; text?: string }>) {
      if (p.type === 'text' && typeof p.text === 'string' && p.text.trim().length > 0) {
        const t = p.text.trim().replace(/\s+/g, ' ');
        return t.length > 60 ? `${t.slice(0, 60)}…` : t;
      }
    }
  }
  return null;
}

/**
 * Hydrate state from localStorage. Includes one-time migration from the
 * pre-multi-conversation era — if no conversations exist but legacy
 * chat/canvas keys do, lift them into a single migrated conversation.
 */
function loadInitial(): { conversations: Conversation[]; activeId: string } {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Conversation[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const activeId =
          localStorage.getItem(ACTIVE_ID_KEY) ?? parsed[0]!.id;
        const active = parsed.find((c) => c.id === activeId) ?? parsed[0]!;
        return { conversations: parsed, activeId: active.id };
      }
    }

    // Migration path — single-conversation users coming from earlier builds.
    const legacyChat = localStorage.getItem(LEGACY_CHAT_KEY);
    const legacyCanvas = localStorage.getItem(LEGACY_CANVAS_KEY);
    if (legacyChat || legacyCanvas) {
      const messages = legacyChat ? (JSON.parse(legacyChat) as UIMessage[]) : [];
      const canvasSnapshot = legacyCanvas
        ? (JSON.parse(legacyCanvas) as TLEditorSnapshot)
        : undefined;
      const conv: Conversation = {
        ...emptyConversation(),
        title: deriveTitle(messages) ?? 'Migrated chat',
        messages,
        canvasSnapshot,
      };
      return { conversations: [conv], activeId: conv.id };
    }
  } catch (e) {
    console.warn('[conversations] hydrate failed:', e);
  }

  // Fresh start — one empty conversation.
  const conv = emptyConversation();
  return { conversations: [conv], activeId: conv.id };
}

function persist(conversations: Conversation[], activeId: string): void {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
    localStorage.setItem(ACTIVE_ID_KEY, activeId);
  } catch (e) {
    console.warn('[conversations] persist failed:', e);
  }
}

const initial = loadInitial();

export const useConversationsStore = create<ConversationsStore>((set, get) => ({
  conversations: initial.conversations,
  activeId: initial.activeId,

  createNew: () => {
    const conv = emptyConversation();
    set((s) => {
      const conversations = [conv, ...s.conversations];
      persist(conversations, conv.id);
      return { conversations, activeId: conv.id };
    });
    return conv.id;
  },

  selectOne: (id) => {
    set((s) => {
      if (!s.conversations.some((c) => c.id === id)) return s;
      persist(s.conversations, id);
      return { activeId: id };
    });
  },

  deleteOne: (id) => {
    set((s) => {
      const remaining = s.conversations.filter((c) => c.id !== id);
      // Always keep at least one conversation around so the UI never has
      // a "no active conversation" state to handle.
      const conversations = remaining.length > 0 ? remaining : [emptyConversation()];
      const activeId =
        s.activeId === id ? conversations[0]!.id : s.activeId;
      persist(conversations, activeId);
      return { conversations, activeId };
    });
  },

  renameOne: (id, title) => {
    set((s) => {
      const conversations = s.conversations.map((c) =>
        c.id === id ? { ...c, title: title.trim() || 'Untitled', updatedAt: Date.now() } : c,
      );
      persist(conversations, s.activeId);
      return { conversations };
    });
  },

  saveMessages: (id, messages) => {
    set((s) => {
      const conversations = s.conversations.map((c) => {
        if (c.id !== id) return c;
        // Auto-title once the user posts their first message — only if the
        // user hasn't already manually renamed.
        const title =
          c.title === 'New chat' || c.title === 'Migrated chat'
            ? deriveTitle(messages) ?? c.title
            : c.title;
        return { ...c, messages, title, updatedAt: Date.now() };
      });
      persist(conversations, s.activeId);
      return { conversations };
    });
  },

  saveCanvasSnapshot: (id, snapshot) => {
    set((s) => {
      const conversations = s.conversations.map((c) =>
        c.id === id ? { ...c, canvasSnapshot: snapshot, updatedAt: Date.now() } : c,
      );
      persist(conversations, s.activeId);
      return { conversations };
    });
  },

  getActive: () => {
    const s = get();
    return (
      s.conversations.find((c) => c.id === s.activeId) ?? s.conversations[0]!
    );
  },
}));

import { create } from 'zustand';

/**
 * Per-conversation preference counters.
 *
 * The agent memory feature: track how the user reacts to widgets the
 * agent places and surface those signals back into the system prompt
 * for future turns. Three signals per kind:
 *   - placed:  the agent landed a widget of this kind on the canvas
 *   - deleted: a widget of this kind was removed (manual X click,
 *              /remove-selected slash command, or agent-driven clear)
 *   - pinned:  user explicitly pinned a widget of this kind so it
 *              survives /clear (strong positive signal)
 *
 * Persistence: localStorage, keyed by conversationId. Cleared per
 * conversation when the user resets that thread; never expires
 * automatically (the agent learns what you actually use over time).
 *
 * Scoring: top preferred / top avoided are derived from
 *   score(kind) = placed + 2*pinned - deleted
 * Pin counts double because pinning is an active gesture; delete
 * counts negatively because the user actively dismissed.
 */

const KEY_PREFIX = 'opencanvas:preferences:';

/** Maximum kinds to surface in either direction in the agent prompt
 *  hint — avoid bloating the system prompt past usefulness. */
export const PREF_TOP_N = 5;

export type KindCounters = {
  placed: number;
  deleted: number;
  pinned: number;
};

export type ConversationPreferences = {
  byKind: Record<string, KindCounters>;
  updatedAt: number;
};

function emptyPrefs(): ConversationPreferences {
  return { byKind: {}, updatedAt: 0 };
}

function loadFromStorage(conversationId: string): ConversationPreferences {
  if (typeof localStorage === 'undefined') return emptyPrefs();
  try {
    const raw = localStorage.getItem(KEY_PREFIX + conversationId);
    if (!raw) return emptyPrefs();
    const parsed = JSON.parse(raw) as ConversationPreferences;
    if (!parsed || typeof parsed !== 'object' || !parsed.byKind) {
      return emptyPrefs();
    }
    return parsed;
  } catch {
    return emptyPrefs();
  }
}

function persist(
  conversationId: string,
  prefs: ConversationPreferences,
): void {
  try {
    localStorage.setItem(KEY_PREFIX + conversationId, JSON.stringify(prefs));
  } catch {
    /* private mode etc. */
  }
}

type Store = {
  /** Per-conversation preference state. */
  byConversation: Record<string, ConversationPreferences>;
  /** Hydrate a conversation's prefs from localStorage. Idempotent. */
  hydrate: (conversationId: string) => void;
  /** Increment one of the three signal counters. */
  record: (
    conversationId: string,
    kind: string,
    signal: keyof KindCounters,
  ) => void;
  /** Wipe a conversation's prefs (e.g. /clear or user reset). */
  clear: (conversationId: string) => void;
};

export const usePreferences = create<Store>((set, get) => ({
  byConversation: {},
  hydrate: (conversationId) => {
    if (get().byConversation[conversationId]) return;
    const prefs = loadFromStorage(conversationId);
    set((s) => ({
      byConversation: { ...s.byConversation, [conversationId]: prefs },
    }));
  },
  record: (conversationId, kind, signal) => {
    if (!kind) return;
    set((s) => {
      const cur = s.byConversation[conversationId] ?? emptyPrefs();
      const counters = cur.byKind[kind] ?? { placed: 0, deleted: 0, pinned: 0 };
      const next: ConversationPreferences = {
        byKind: {
          ...cur.byKind,
          [kind]: { ...counters, [signal]: counters[signal] + 1 },
        },
        updatedAt: Date.now(),
      };
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
      const next = { ...s.byConversation };
      delete next[conversationId];
      return { byConversation: next };
    });
  },
}));

/**
 * Score a kind's counters into a single number. Positive = preferred,
 * negative = avoided. Exposed for tests.
 */
export function scoreKind(c: KindCounters): number {
  return c.placed + 2 * c.pinned - c.deleted;
}

/**
 * Derive the agent-facing summary: top preferred + top avoided kinds.
 * Returns empty arrays when there's no signal yet (the prompt-injection
 * helper skips the section when both arrays are empty).
 */
export function summarisePreferences(
  prefs: ConversationPreferences | undefined,
  topN: number = PREF_TOP_N,
): {
  preferred: Array<{ kind: string; score: number; counters: KindCounters }>;
  avoided: Array<{ kind: string; score: number; counters: KindCounters }>;
} {
  if (!prefs || !prefs.byKind) return { preferred: [], avoided: [] };
  const all = Object.entries(prefs.byKind).map(([kind, counters]) => ({
    kind,
    counters,
    score: scoreKind(counters),
  }));
  const preferred = all
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
  const avoided = all
    .filter((x) => x.score < 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, topN);
  return { preferred, avoided };
}

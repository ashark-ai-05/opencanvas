import { create } from 'zustand';

/**
 * Trigger-only store for chat-level actions that need to be invoked from
 * outside the Chat component (e.g. a header button). Chat registers its
 * imperative handler on mount; consumers call the trigger.
 *
 * Why not lift state to App: keeps Chat self-contained — useChat's hook
 * state stays inside the Chat component, the store only carries the
 * callback handle.
 */
type ChatActions = {
  newChat: (() => void) | null;
  setNewChat: (fn: (() => void) | null) => void;
};

export const useChatActions = create<ChatActions>((set) => ({
  newChat: null,
  setNewChat: (fn) => set({ newChat: fn }),
}));

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
  /** Triggered by /team — sends a prompt through the multi-agent route. */
  sendTeam: ((prompt: string) => void) | null;
  setSendTeam: (fn: ((prompt: string) => void) | null) => void;
  /** Send a regular chat message programmatically (used by selection-scoped
   *  slash commands, Cmd+K palette, file drop, etc.). */
  sendChat: ((prompt: string) => void) | null;
  setSendChat: (fn: ((prompt: string) => void) | null) => void;
};

export const useChatActions = create<ChatActions>((set) => ({
  newChat: null,
  setNewChat: (fn) => set({ newChat: fn }),
  sendTeam: null,
  setSendTeam: (fn) => set({ sendTeam: fn }),
  sendChat: null,
  setSendChat: (fn) => set({ sendChat: fn }),
}));

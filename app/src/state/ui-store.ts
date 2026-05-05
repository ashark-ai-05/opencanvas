/**
 * Cross-cutting UI flags. Kept tiny — store one slice per concern so a
 * setter from `Chat.tsx` doesn't accidentally re-render header buttons.
 *
 * Spec: REPLICATION-PROMPT.md §13 — `ui-store`.
 */
import { create } from 'zustand';

export type ChatWindowMode = 'open' | 'minimized' | 'collapsed';
export type ChatWindowFullMode = 'normal' | 'full';

export type ChatWindowState = {
  mode: ChatWindowMode;
  fullMode: ChatWindowFullMode;
  /** Persisted drag offsets so the floating chat survives re-mounts. */
  dragX: number;
  dragY: number;
  /** Idle "bobbing" animation toggles when the user hasn't asked anything in a while. */
  autoBob: boolean;
};

export type UiState = {
  chatWindow: ChatWindowState;
  setChatWindow: (patch: Partial<ChatWindowState>) => void;
  /** True while a chat turn is mid-stream — drives the composer status pill. */
  chatBusy: boolean;
  setChatBusy: (busy: boolean) => void;
  /** Sources panel drawer open / closed. */
  sourcesOpen: boolean;
  setSourcesOpen: (open: boolean) => void;
  /** Mirrors `editor.getCurrentToolId() === 'hand'` so header buttons can show pressed state. */
  handToolActive: boolean;
  setHandToolActive: (active: boolean) => void;
  /**
   * When true, wheel events outside `.strata-card-body` are swallowed at
   * the document level so trackpad scroll inside a card doesn't pan the
   * canvas. `Canvas.tsx` installs the listener; this flag toggles it.
   */
  canvasWheelLocked: boolean;
  setCanvasWheelLocked: (locked: boolean) => void;
};

const DEFAULT_CHAT_WINDOW: ChatWindowState = {
  mode: 'open',
  fullMode: 'normal',
  dragX: 0,
  dragY: 0,
  autoBob: false,
};

export const useUiStore = create<UiState>((set) => ({
  chatWindow: DEFAULT_CHAT_WINDOW,
  setChatWindow: (patch) =>
    set((state) => ({ chatWindow: { ...state.chatWindow, ...patch } })),
  chatBusy: false,
  setChatBusy: (chatBusy) => set({ chatBusy }),
  sourcesOpen: false,
  setSourcesOpen: (sourcesOpen) => set({ sourcesOpen }),
  handToolActive: false,
  setHandToolActive: (handToolActive) => set({ handToolActive }),
  canvasWheelLocked: false,
  setCanvasWheelLocked: (canvasWheelLocked) => set({ canvasWheelLocked }),
}));

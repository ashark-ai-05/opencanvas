/**
 * Cross-cutting UI flags. Kept tiny — store one slice per concern so a
 * setter from `Chat.tsx` doesn't accidentally re-render header buttons.
 *
 * Spec: REPLICATION-PROMPT.md §13 — `ui-store`.
 */
import { create } from 'zustand';

const UI_STORE_KEY = 'opencanvas:ui-store';

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
   * When true, wheel events outside `.opencanvas-card-body` are swallowed at
   * the document level so trackpad scroll inside a card doesn't pan the
   * canvas. `Canvas.tsx` installs the listener; this flag toggles it.
   */
  canvasWheelLocked: boolean;
  setCanvasWheelLocked: (locked: boolean) => void;
  /**
   * When true, the canvas minimap collapses to a header-only chip in
   * the bottom-left corner. Click the chevron to expand again.
   */
  canvasMapCollapsed: boolean;
  setCanvasMapCollapsed: (collapsed: boolean) => void;
  /**
   * When true the horizontal conversation tab strip is shown between the
   * chat titlebar and the chat body. Persisted to localStorage so the
   * preference survives page reloads.
   */
  chatTabsVisible: boolean;
  setChatTabsVisible: (visible: boolean) => void;
};

const DEFAULT_CHAT_WINDOW: ChatWindowState = {
  mode: 'open',
  fullMode: 'normal',
  dragX: 0,
  dragY: 0,
  autoBob: false,
};

/** Hand-rolled persistence for the few flags we want to survive reloads. */
function loadPersistedUiFlags(): { chatTabsVisible: boolean } {
  try {
    const raw = localStorage.getItem(UI_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return {
        chatTabsVisible: typeof parsed.chatTabsVisible === 'boolean' ? parsed.chatTabsVisible : true,
      };
    }
  } catch {
    // ignore — fall through to defaults
  }
  return { chatTabsVisible: true };
}

function persistUiFlags(flags: { chatTabsVisible: boolean }): void {
  try {
    localStorage.setItem(UI_STORE_KEY, JSON.stringify(flags));
  } catch {
    // ignore storage errors
  }
}

const persistedFlags = loadPersistedUiFlags();

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
  canvasMapCollapsed: false,
  setCanvasMapCollapsed: (canvasMapCollapsed) => set({ canvasMapCollapsed }),
  chatTabsVisible: persistedFlags.chatTabsVisible,
  setChatTabsVisible: (chatTabsVisible) => {
    persistUiFlags({ chatTabsVisible });
    set({ chatTabsVisible });
  },
}));

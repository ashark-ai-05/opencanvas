import { create } from 'zustand';

/**
 * Live counts of canvas content. Canvas.tsx writes on every editor change
 * (via the existing snapshot listener); UI surfaces (header, empty-state
 * hint) read it without subscribing to tldraw directly.
 */
type CanvasStats = {
  widgetCount: number;
  setWidgetCount: (n: number) => void;
};

export const useCanvasStats = create<CanvasStats>((set) => ({
  widgetCount: 0,
  setWidgetCount: (n) => set({ widgetCount: n }),
}));

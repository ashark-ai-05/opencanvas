import { create } from 'zustand';

/**
 * Live counts of canvas content. Canvas.tsx writes on every editor change
 * (via the existing snapshot listener); UI surfaces (header, empty-state
 * hint) read it without subscribing to tldraw directly.
 */
type CanvasStats = {
  widgetCount: number;
  /** Current zoom factor (1 = 100%, 0.5 = 50%, 2 = 200%). */
  zoom: number;
  setWidgetCount: (n: number) => void;
  setZoom: (z: number) => void;
};

export const useCanvasStats = create<CanvasStats>((set) => ({
  widgetCount: 0,
  zoom: 1,
  setWidgetCount: (n) => set({ widgetCount: n }),
  setZoom: (z) => set({ zoom: z }),
}));

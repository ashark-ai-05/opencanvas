import { create } from 'zustand';

/**
 * Browser-side cache of registered plugin kinds, mirrored from the
 * backend WidgetRegistry. Synced via the canvas SSE: the connect
 * handshake ships the current set as `widget-kind` events with
 * type:register, and subsequent register/unregister events stream
 * down the same channel.
 *
 * The cache is global (matches the backend's single-process registry).
 * Conversations don't have their own plugin sets in V1.
 */

export type IframeRenderer = {
  type: 'iframe';
  srcdoc: string;
  sandbox?: string;
  defaultSize?: { w: number; h: number };
};
export type PluginRenderer = IframeRenderer;
export type PluginKindDescriptor = {
  kind: string;
  label?: string;
  description?: string;
  renderer: PluginRenderer;
};

type Store = {
  /** Map of registered plugin kind → descriptor. */
  byKind: Record<string, PluginKindDescriptor>;
  /** True once the SSE has delivered the initial registry snapshot. */
  hydrated: boolean;
  upsert: (d: PluginKindDescriptor) => void;
  remove: (kind: string) => void;
  setHydrated: (v: boolean) => void;
};

export const usePluginRegistry = create<Store>((set) => ({
  byKind: {},
  hydrated: false,
  upsert: (d) =>
    set((s) => ({ byKind: { ...s.byKind, [d.kind]: d } })),
  remove: (kind) =>
    set((s) => {
      if (!s.byKind[kind]) return s;
      const { [kind]: _gone, ...rest } = s.byKind;
      return { byKind: rest };
    }),
  setHydrated: (v) => set({ hydrated: v }),
}));

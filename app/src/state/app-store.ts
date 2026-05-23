import { create } from 'zustand';
import { fetchHealth, type HealthResponse } from '../api/health';

export type HealthState =
  | { status: 'loading' }
  | { status: 'ok'; data: HealthResponse }
  | { status: 'fail'; error: string };

type AppStore = {
  health: HealthState;
  refreshHealth: () => Promise<void>;
};

export const useAppStore = create<AppStore>((set) => ({
  health: { status: 'loading' },
  refreshHealth: async () => {
    set({ health: { status: 'loading' } });
    try {
      const data = await fetchHealth();
      set({ health: { status: 'ok', data } });
    } catch (e) {
      set({
        health: { status: 'fail', error: e instanceof Error ? e.message : String(e) },
      });
    }
  },
}));

import { create } from 'zustand';

/**
 * Live counts of indexed knowledge — total chunks across all sources +
 * the most recent delta added by a conversation index round-trip.
 *
 * The header KB badge reads `totalChunks` and animates the number when
 * it changes; `lastDelta` drives a brief "+N" floater above the badge.
 *
 * Initial value is hydrated from /v1/sources/list on app start (see
 * App.tsx); subsequent deltas come from the chat's index-conversation
 * fire-and-forget on each completed turn.
 */
type KbStats = {
  totalChunks: number;
  lastDelta: number;
  hydrated: boolean;
  hydrate: (total: number) => void;
  bump: (delta: number) => void;
};

export const useKbStats = create<KbStats>((set) => ({
  totalChunks: 0,
  lastDelta: 0,
  hydrated: false,
  hydrate: (total) => set({ totalChunks: total, hydrated: true, lastDelta: 0 }),
  bump: (delta) =>
    set((s) => ({
      totalChunks: s.totalChunks + delta,
      lastDelta: delta,
    })),
}));

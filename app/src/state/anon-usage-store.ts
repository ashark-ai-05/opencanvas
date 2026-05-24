/**
 * Anonymous-usage counter.
 *
 * Tracks how many chat messages a visitor has sent on the demo without
 * configuring BYO model + API key. Drives a soft signup-ish nudge
 * (`<ByoNudge />`) when the count crosses a threshold — encourages
 * heavy users to switch to their own key before they hit the demo's
 * shared rate limit.
 *
 * NOT a hard block; just a banner. When real per-user auth ships
 * later, the same threshold becomes the trigger for the actual
 * signup wall.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const NUDGE_THRESHOLD = 8;

interface AnonUsageStore {
  /** Total chat messages this browser has sent (incl. team route). */
  messagesSent: number;
  /** When set, the user dismissed the nudge at this message count;
   *  re-show when they cross the next threshold (current + threshold). */
  dismissedAt: number | null;
  bumpMessages: () => void;
  dismissNudge: () => void;
  shouldShowNudge: (hasOverride: boolean) => boolean;
}

export const useAnonUsage = create<AnonUsageStore>()(
  persist(
    (set, get) => ({
      messagesSent: 0,
      dismissedAt: null,
      bumpMessages: () =>
        set((state) => ({ messagesSent: state.messagesSent + 1 })),
      dismissNudge: () => set((state) => ({ dismissedAt: state.messagesSent })),
      shouldShowNudge: (hasOverride: boolean) => {
        // If the user has their own key configured, never nudge.
        if (hasOverride) return false;
        const { messagesSent, dismissedAt } = get();
        if (messagesSent < NUDGE_THRESHOLD) return false;
        // After dismissal, wait for ANOTHER threshold-worth of usage
        // before re-surfacing. Avoids the "I clicked X, why is it
        // back next message" feeling.
        if (dismissedAt !== null && messagesSent < dismissedAt + NUDGE_THRESHOLD) {
          return false;
        }
        return true;
      },
    }),
    {
      name: 'opencanvas:anon-usage:v1',
      partialize: (state) => ({
        messagesSent: state.messagesSent,
        dismissedAt: state.dismissedAt,
      }),
    },
  ),
);

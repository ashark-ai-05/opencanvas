import { create } from 'zustand';

const DISMISS_KEY = 'opencanvas:star-nudge:v1';

function readDismissed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Once-per-browser "star us on GitHub" nudge. Offered after the first
 * auto-tidy (the no-key wow moment) or after a successful share.
 */
type StarNudgeState = {
  visible: boolean;
  offer: () => void;
  dismiss: () => void;
  starred: () => void;
};

export const useStarNudge = create<StarNudgeState>((set, get) => ({
  visible: false,
  offer: () => {
    if (readDismissed() || get().visible) return;
    set({ visible: true });
  },
  dismiss: () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    set({ visible: false });
  },
  starred: () => {
    get().dismiss();
  },
}));

export const STAR_NUDGE_EVENT = 'opencanvas:offer-star-nudge';
export const STAR_REPO_URL = 'https://github.com/ashark-ai-05/opencanvas';

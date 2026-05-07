import { create } from 'zustand';

/**
 * Theme toggle. Persists choice in localStorage and applies it to the
 * <html> element via data-theme so the CSS-variable overrides at
 * :root[data-theme='light'] take effect for the entire tree.
 *
 * Default: dark (the original look). The toggle lives in the header.
 */
export type Theme = 'dark' | 'light';

const KEY = 'opencanvas:theme';

function loadInitial(): Theme {
  if (typeof localStorage === 'undefined') return 'dark';
  const raw = localStorage.getItem(KEY);
  return raw === 'light' ? 'light' : 'dark';
}

function applyToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

type ThemeStore = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
};

export const useThemeStore = create<ThemeStore>((set, get) => {
  const initial = loadInitial();
  applyToDocument(initial);
  return {
    theme: initial,
    setTheme: (t) => {
      try {
        localStorage.setItem(KEY, t);
      } catch {
        /* private mode etc. */
      }
      applyToDocument(t);
      set({ theme: t });
    },
    toggle: () => {
      const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
      get().setTheme(next);
    },
  };
});

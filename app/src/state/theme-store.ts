import { create } from 'zustand';

/**
 * Theme registry + selector store.
 *
 * Each theme is a complete set of CSS-variable overrides defined in
 * globals.css under :root[data-theme='<name>']. Switching themes here
 * just flips the data-theme attribute on <html> — every downstream
 * rule (cards, chat panel, palette, etc.) recolors automatically
 * because every visual surface reads from the variables, not from
 * hardcoded literals.
 *
 * Persistence: the chosen theme is stashed in localStorage; the
 * tldraw color-scheme preference is mirrored from this store on
 * canvas mount (Canvas.tsx subscribes) so the canvas background
 * matches the rest of the UI.
 */

/**
 * The 5 shipped themes:
 *   - dark      : neutral charcoal + violet/magenta accent (default)
 *   - light     : near-white surfaces + same accent (printed-doc feel)
 *   - midnight  : deep indigo/navy + cool electric-blue accent
 *   - sunset    : warm wine/brown + orange/amber accent
 *   - mono      : pure grayscale, no chromatic accent (Linear/Vercel feel)
 *
 * Each theme keeps the SAME role hues (primary=violet, detail=blue,
 * etc.) so widgets stay glanceable across themes — only chrome /
 * surface / brand gradient shifts. The exception is `mono`, which
 * desaturates roles to fit the monochrome aesthetic.
 */
export const THEMES = ['dark', 'light', 'midnight', 'sunset', 'mono'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Tiny preview metadata for the picker UI. Each theme exposes 3
 * sample swatches (background, surface, accent) the picker renders
 * as a mini chip. Kept here next to the type so adding a new theme
 * is a single-file change.
 */
export const THEME_META: Record<
  Theme,
  { label: string; description: string; swatches: [string, string, string] }
> = {
  dark: {
    label: 'Dark',
    description: 'Neutral charcoal · violet accent',
    swatches: ['#0a0a0c', '#1c1c22', '#a78bfa'],
  },
  light: {
    label: 'Light',
    description: 'Paper white · violet accent',
    swatches: ['#fafafa', '#ffffff', '#a78bfa'],
  },
  midnight: {
    label: 'Midnight',
    description: 'Deep navy · electric blue',
    swatches: ['#070a14', '#131a2e', '#60a5fa'],
  },
  sunset: {
    label: 'Sunset',
    description: 'Warm wine · amber accent',
    swatches: ['#1a0f0a', '#2a1814', '#fb923c'],
  },
  mono: {
    label: 'Mono',
    description: 'Pure grayscale, no accent',
    swatches: ['#0a0a0a', '#1f1f1f', '#fafafa'],
  },
};

const KEY = 'opencanvas:theme';

function loadInitial(): Theme {
  if (typeof localStorage === 'undefined') return 'dark';
  const raw = localStorage.getItem(KEY);
  return (THEMES as readonly string[]).includes(raw as string)
    ? (raw as Theme)
    : 'dark';
}

function applyToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Map a custom theme to a tldraw color-scheme bucket — tldraw only
 * has 'light' / 'dark', so anything that's perceptually dark
 * (midnight, sunset, mono) maps to dark; only the explicit `light`
 * theme maps to light. Used by Canvas.tsx via store.subscribe.
 */
export function tldrawColorSchemeFor(theme: Theme): 'dark' | 'light' {
  return theme === 'light' ? 'light' : 'dark';
}

type ThemeStore = {
  theme: Theme;
  setTheme: (t: Theme) => void;
  /** Cycle to the next theme in THEMES order — used by hotkeys. */
  cycle: () => void;
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
    cycle: () => {
      const cur = get().theme;
      const idx = THEMES.indexOf(cur);
      const next = THEMES[(idx + 1) % THEMES.length]!;
      get().setTheme(next);
    },
  };
});

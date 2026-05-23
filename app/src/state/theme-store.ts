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
 * The 4 shipped themes (all dark-family — light was removed in the
 * modernise-ui project, spec 2026-05-09):
 *   - dark      : neutral charcoal + violet/magenta accent (default)
 *   - midnight  : deep indigo/navy + cool electric-blue accent
 *   - sunset    : warm wine/brown + orange/amber accent
 *   - mono      : pure grayscale, no chromatic accent
 *
 * Each theme keeps the same role hues (primary=violet, detail=blue,
 * etc.) so widgets stay glanceable across themes — only chrome /
 * surface / brand gradient shifts. The exception is `mono`, which
 * desaturates roles to fit the monochrome aesthetic.
 */
export const THEMES = ['dark', 'midnight', 'sunset', 'mono'] as const;
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

/**
 * Theme picker is currently disabled — the app force-defaults to
 * `dark` regardless of any value previously stored in localStorage.
 * The theme infrastructure (THEMES enum, per-theme CSS-var blocks
 * in globals.css, theme-aware glass-rgb variable) stays in place
 * so re-enabling the picker is a single-file change in App.tsx.
 *
 * On load we also CLEAR any stored value so a user who previously
 * picked `light` doesn't keep getting served the broken light
 * theme.
 */
function loadInitial(): Theme {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* private mode etc. */
    }
  }
  return 'dark';
}

function applyToDocument(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

/**
 * Map a custom theme to a tldraw color-scheme bucket. All four shipped
 * themes are dark-family. The 'light' theme was removed in the
 * modernise-ui project (spec 2026-05-09); tldraw's canvas always
 * renders against a dark surface.
 */
export function tldrawColorSchemeFor(_theme: Theme): 'dark' {
  // All four shipped themes are dark-family. The 'light' theme was
  // removed in the modernise-ui project (spec 2026-05-09); tldraw's
  // canvas always renders against a dark surface.
  return 'dark';
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

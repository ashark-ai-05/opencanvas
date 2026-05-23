import { describe, it, expect, beforeEach, vi } from 'vitest';

async function freshStore() {
  vi.resetModules();
  return await import('../../app/src/state/theme-store');
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme-store — light theme removal', () => {
  it("THEMES tuple does not include 'light'", async () => {
    const mod = await freshStore();
    expect(mod.THEMES).not.toContain('light');
  });

  it('THEME_META does not have a light entry', async () => {
    const mod = await freshStore();
    expect(mod.THEME_META).not.toHaveProperty('light');
  });

  it('THEMES contains exactly the 4 dark-family themes', async () => {
    const mod = await freshStore();
    expect([...mod.THEMES].sort()).toEqual(
      ['dark', 'midnight', 'mono', 'sunset'],
    );
  });

  it("tldrawColorSchemeFor always returns 'dark'", async () => {
    const mod = await freshStore();
    for (const theme of mod.THEMES) {
      expect(mod.tldrawColorSchemeFor(theme)).toBe('dark');
    }
  });

  it('boots with dark theme even if localStorage previously had light', async () => {
    localStorage.setItem('opencanvas:theme', 'light');
    const mod = await freshStore();
    const initial = mod.useThemeStore.getState().theme;
    expect(initial).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

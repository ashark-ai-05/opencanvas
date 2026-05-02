import '@testing-library/jest-dom/vitest';

// Node 24+ exposes a built-in `localStorage` global that shadows jsdom's.
// Replace it with a proper in-memory implementation so tests that rely on
// localStorage (e.g., canvas persistence) work correctly.
if (typeof localStorage === 'undefined' || typeof localStorage.clear !== 'function') {
  const store: Record<string, string> = {};
  const mock: Storage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = String(value); },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    key: (index: number) => Object.keys(store)[index] ?? null,
    get length() { return Object.keys(store).length; },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mock,
    writable: true,
    configurable: true,
  });
}

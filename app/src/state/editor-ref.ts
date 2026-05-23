import type { Editor } from 'tldraw';

let current: Editor | null = null;

const isDev =
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV ?? false;

export function setEditor(e: Editor | null): void {
  current = e;
  // Expose the editor on window in dev builds only so e2e/recording
  // scripts (Playwright) can drive canvas state via the public tldraw
  // API without a fragile click-chain. Stripped from prod bundles.
  if (isDev && typeof window !== 'undefined') {
    (window as unknown as { __OPENCANVAS_EDITOR__?: Editor | null }).__OPENCANVAS_EDITOR__ = e;
  }
}

export function getEditor(): Editor | null {
  return current;
}

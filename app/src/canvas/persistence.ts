import type { TLEditorSnapshot } from 'tldraw';

export const CANVAS_STORAGE_KEY = 'llm-wiki:canvas:default';

export function saveCanvasSnapshot(snapshot: TLEditorSnapshot): void {
  try {
    localStorage.setItem(CANVAS_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (e) {
    console.warn('[canvas] save failed:', e);
  }
}

export function loadCanvasSnapshot(): TLEditorSnapshot | null {
  const raw = localStorage.getItem(CANVAS_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TLEditorSnapshot;
  } catch (e) {
    console.warn('[canvas] load failed:', e);
    return null;
  }
}

export function clearCanvasSnapshot(): void {
  localStorage.removeItem(CANVAS_STORAGE_KEY);
}

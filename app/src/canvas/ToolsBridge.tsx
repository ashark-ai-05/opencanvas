import { useEffect } from 'react';
import { useEditor, useValue } from 'tldraw';
import { useUiStore } from '../state/ui-store';
import { setToolsFromEditor, clearTools } from '../state/tools-ref';

/**
 * Mounted INSIDE the Tldraw component (so `useEditor` is available) to
 * mirror tldraw editor state into Zustand stores the rest of the app
 * reads — no prop-drilling, no event bus.
 *
 * Specifically:
 *   - publishes the editor handle into `tools-ref` so HeaderDrawTools can
 *     switch the active tldraw tool without going through editor-ref.
 *   - mirrors `editor.getCurrentToolId() === 'hand'` into `ui-store` so
 *     header buttons render their pressed state correctly.
 *
 */
export function ToolsBridge() {
  const editor = useEditor();
  const setHandToolActive = useUiStore((s) => s.setHandToolActive);

  useEffect(() => {
    setToolsFromEditor(editor);
    return () => clearTools();
  }, [editor]);

  // Reactive subscription to the active tool id.
  const currentToolId = useValue(
    'tldraw current tool id',
    () => editor.getCurrentToolId(),
    [editor],
  );
  useEffect(() => {
    setHandToolActive(currentToolId === 'hand');
  }, [currentToolId, setHandToolActive]);

  return null;
}

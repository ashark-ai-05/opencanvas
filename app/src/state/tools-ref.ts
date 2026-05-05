/**
 * Singleton handle to tldraw's tools registry. Set on canvas mount; read
 * by header buttons (HeaderDrawTools) so they can switch the active
 * tldraw tool without going through the editor reference.
 *
 * Spec: REPLICATION-PROMPT.md §13 — `tools-ref`.
 */
import type { Editor } from 'tldraw';

type ToolsHandle = {
  selectTool: (id: string) => void;
  getCurrentToolId: () => string | undefined;
};

let current: ToolsHandle | null = null;

export function setToolsFromEditor(editor: Editor): void {
  current = {
    selectTool: (id: string) => editor.setCurrentTool(id),
    getCurrentToolId: () => editor.getCurrentToolId(),
  };
}

export function getTools(): ToolsHandle | null {
  return current;
}

export function clearTools(): void {
  current = null;
}

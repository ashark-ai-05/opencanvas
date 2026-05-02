import { useCallback, useMemo, useRef } from 'react';
import { Tldraw, type Editor, type TLEditorSnapshot } from 'tldraw';
import 'tldraw/tldraw.css';
import { TextNoteShapeUtil } from './shapes/text-note';
import {
  loadCanvasSnapshot,
  saveCanvasSnapshot,
} from './persistence';

const customShapeUtils = [TextNoteShapeUtil];
const SAVE_DEBOUNCE_MS = 500;

export function Canvas() {
  const initialSnapshot = useMemo<TLEditorSnapshot | undefined>(() => {
    const loaded = loadCanvasSnapshot();
    return loaded ?? undefined;
  }, []);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMount = useCallback(
    (editor: Editor) => {
      editor.store.listen(
        () => {
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            saveCanvasSnapshot(editor.getSnapshot());
          }, SAVE_DEBOUNCE_MS);
        },
        { source: 'user' }
      );
    },
    []
  );

  return (
    <div className="size-full" style={{ position: 'relative' }}>
      <Tldraw
        shapeUtils={customShapeUtils}
        snapshot={initialSnapshot}
        onMount={handleMount}
        // Hide tldraw's branding to keep the surface ours.
        hideUi={false}
      />
    </div>
  );
}

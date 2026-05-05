import { useCallback, useMemo, useRef } from 'react';
import { Tldraw, type Editor } from 'tldraw';
import 'tldraw/tldraw.css';
import { TextNoteShapeUtil } from './shapes/text-note';
import { MarkdownShapeUtil } from './shapes/markdown';
import { CodeBlockShapeUtil } from './shapes/code-block';
import { TicketCardShapeUtil } from './shapes/ticket-card';
import { WebEmbedShapeUtil } from './shapes/web-embed';
import { KeyValueCardShapeUtil } from './shapes/key-value-card';
import { TableShapeUtil } from './shapes/table';
import { TimelineShapeUtil } from './shapes/timeline';
import { FileTreeShapeUtil } from './shapes/file-tree';
import { CompositeShapeUtil } from './shapes/composite';
import { TasksShapeUtil } from './shapes/tasks';
import { KanbanShapeUtil } from './shapes/kanban';
import { StickyNoteShapeUtil } from './shapes/sticky-note';
import { computeCanvasSnapshot } from './snapshot';
import { setLatestSnapshot } from '../state/snapshot-ref';
import { setEditor } from '../state/editor-ref';
import { useTemplateStore } from '../state/template-store';
import { useCanvasStats } from '../state/canvas-stats-store';
import { useConversationsStore } from '../state/conversations-store';
import { DebugToolbar } from '../components/DebugToolbar';
import { SearchBar } from '../components/SearchBar';
import { TemplatePicker } from '../components/TemplatePicker';
import { EmptyCanvasHint } from '../components/EmptyCanvasHint';

const customShapeUtils = [
  // Plan 4b — proof-of-wire (kept for backwards compat with saved canvases)
  TextNoteShapeUtil,
  // Plan 4c — real widget catalog
  MarkdownShapeUtil,
  CodeBlockShapeUtil,
  TicketCardShapeUtil,
  WebEmbedShapeUtil,
  KeyValueCardShapeUtil,
  // Phase 4 — extended kinds
  TableShapeUtil,
  TimelineShapeUtil,
  FileTreeShapeUtil,
  // Phase 5 — composite + interactive widgets
  CompositeShapeUtil,
  TasksShapeUtil,
  KanbanShapeUtil,
  StickyNoteShapeUtil,
];
const SAVE_DEBOUNCE_MS = 500;

export function Canvas() {
  // Bind to the active conversation. App.tsx re-mounts Canvas via key
  // when activeId changes, so we read once at mount.
  const { activeId, initialSnapshot } = useMemo(() => {
    const conv = useConversationsStore.getState().getActive();
    return { activeId: conv.id, initialSnapshot: conv.canvasSnapshot };
  }, []);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMount = useCallback(
    (editor: Editor) => {
      // Register the editor in a singleton so Chat (rendered outside the
      // Tldraw editor scope) can apply tool directives via getEditor().
      setEditor(editor);

      // Force dark color scheme — Strata is dark-only by design.
      editor.user.updateUserPreferences({ colorScheme: 'dark' });

      // Persist tldraw snapshot back into the active conversation. Source
      // filter is dropped — agent-initiated changes (place_widget) need to
      // save too. Debounce so rapid drag/resize events don't thrash.
      editor.store.listen(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          useConversationsStore
            .getState()
            .saveCanvasSnapshot(activeId, editor.getSnapshot());
        }, SAVE_DEBOUNCE_MS);
      });

      // Publish a canvas snapshot into the singleton ref so Chat (rendered
      // outside the Tldraw editor) can read live editor state on submit.
      const publishSnapshot = () => {
        const tplId = useTemplateStore.getState().activeTemplateId;
        const snap = computeCanvasSnapshot(editor, tplId);
        setLatestSnapshot(snap);
        useCanvasStats.getState().setWidgetCount(snap.widgets.length);
      };

      // Initial publish so the very first chat turn sees current canvas state.
      publishSnapshot();

      editor.store.listen(publishSnapshot);
    },
    [activeId]
  );

  return (
    <div className="size-full" style={{ position: 'relative' }}>
      <Tldraw
        shapeUtils={customShapeUtils}
        snapshot={initialSnapshot}
        onMount={handleMount}
        // Hide tldraw's branding to keep the surface ours.
        hideUi={false}
      >
        <DebugToolbar />
        <SearchBar />
        <TemplatePicker />
        <EmptyCanvasHint />
      </Tldraw>
    </div>
  );
}

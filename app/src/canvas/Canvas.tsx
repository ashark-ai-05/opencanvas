import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Tldraw, type Editor, type TLUiComponents } from 'tldraw';
import 'tldraw/tldraw.css';
import { TextNoteShapeUtil } from './shapes/text-note';
import { ToolsBridge } from './ToolsBridge';
import { CollapsibleStylePanel } from '../components/CollapsibleStylePanel';
import { CanvasGrid } from '../components/CanvasGrid';
import { CanvasMap } from '../components/CanvasMap';
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
import { GenericShapeUtil } from './shapes/generic';
import { TimeShapeUtil } from './shapes/time';
import { PluginShapeUtil } from './shapes/plugin';
import { computeCanvasSnapshot } from './snapshot';
import { setLatestSnapshot } from '../state/snapshot-ref';
import { setEditor } from '../state/editor-ref';
import { useTemplateStore } from '../state/template-store';
import { useCanvasStats } from '../state/canvas-stats-store';
import { useConversationsStore } from '../state/conversations-store';
import { useThemeStore } from '../state/theme-store';
import { useCanvasHistory } from '../state/canvas-history-store';
// SearchBar + TemplatePicker removed: all searches now flow through the
// floating chat (the agent runs search_kb, plus a parallel /v1/search
// call surfaces inline KB hits via <KbHits />). Templates are switched
// via the /template slash command.
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
  // Universal fallback — auto-classifier targets this when no specialized
  // kind fits or a payload fails its specialized schema.
  GenericShapeUtil,
  // Live time widget — clock / timer / stopwatch / pomodoro modes.
  TimeShapeUtil,
  // Plugin widget — renders externally-registered kinds in a sandboxed
  // iframe with a postMessage prop bridge.
  PluginShapeUtil,
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

      // Mirror app theme into tldraw's color scheme so the canvas
      // background matches the rest of the UI. Subscribes for the
      // editor's lifetime so toggling theme updates the canvas live.
      const applyScheme = (theme: 'dark' | 'light') => {
        editor.user.updateUserPreferences({ colorScheme: theme });
      };
      applyScheme(useThemeStore.getState().theme);
      const unsubTheme = useThemeStore.subscribe((s, prev) => {
        if (s.theme !== prev.theme) applyScheme(s.theme);
      });
      // Stash unsubscribe on the editor so it's cleared when the
      // canvas is torn down. Using a closure-typed property keeps
      // tldraw's Editor type intact.
      (editor as unknown as { _opencanvasUnsubTheme?: () => void })
        ._opencanvasUnsubTheme = unsubTheme;

      // Persist tldraw snapshot back into the active conversation. Source
      // filter is dropped — agent-initiated changes (place_widget) need to
      // save too. Debounce so rapid drag/resize events don't thrash.
      // The same debounce drives history capture so a 30s typing burst
      // becomes one history entry, not 60.
      useCanvasHistory.getState().hydrate(activeId);
      let lastHistoryAt = 0;
      const HISTORY_MIN_GAP_MS = 8_000;
      editor.store.listen(() => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(() => {
          const snap = editor.getSnapshot();
          useConversationsStore.getState().saveCanvasSnapshot(activeId, snap);
          // Only push to history when at least HISTORY_MIN_GAP_MS has
          // passed since the last entry — keeps the timeline navigable
          // (no 200 entries in 30 seconds during a heavy edit).
          const now = Date.now();
          if (now - lastHistoryAt >= HISTORY_MIN_GAP_MS) {
            useCanvasHistory.getState().push(activeId, snap);
            lastHistoryAt = now;
          }
        }, SAVE_DEBOUNCE_MS);
      });

      // Publish a canvas snapshot into the singleton ref so Chat (rendered
      // outside the Tldraw editor) can read live editor state on submit.
      const publishSnapshot = () => {
        const tplId = useTemplateStore.getState().activeTemplateId;
        const snap = computeCanvasSnapshot(editor, tplId);
        setLatestSnapshot(snap);
        const stats = useCanvasStats.getState();
        stats.setWidgetCount(snap.widgets.length);
        // Camera state changes (zoom + pan) flow through the same
        // store.listen channel, so this also keeps the header zoom
        // readout reactive.
        const cam = (
          editor as unknown as { getCamera?: () => { z?: number } }
        ).getCamera?.();
        if (cam && typeof cam.z === 'number') stats.setZoom(cam.z);
      };

      // Initial publish so the very first chat turn sees current canvas state.
      publishSnapshot();

      editor.store.listen(publishSnapshot);
    },
    [activeId]
  );

  // Capture-phase wheel listener that scroll-locks the canvas while the
  // pointer is over a SCROLLABLE widget body. Without this, tldraw
  // captures the wheel event before the body's overflow:auto can scroll,
  // so a long code-block / file-tree zooms the canvas instead of
  // scrolling its content. We DON'T preventDefault — only stopPropagation
  // — so the body still receives its native scroll. tldraw never sees it.
  //
  // Always-on (no gate). Outside any card body the listener is a no-op,
  // so tldraw's pan/zoom on the empty canvas is unaffected.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      const body = target?.closest('.opencanvas-card-body') as HTMLElement | null;
      if (!body) return;
      // Only lock when the body actually has overflow content. Idle
      // (non-scrolling) bodies — small markdown notes, single-line
      // tickets — let the wheel through to tldraw so the user can still
      // pan/zoom while hovering over the card.
      const scrollable = body.scrollHeight > body.clientHeight + 1;
      if (!scrollable) return;
      e.stopPropagation();
    };
    document.addEventListener('wheel', onWheel, { capture: true, passive: true });
    return () => document.removeEventListener('wheel', onWheel, { capture: true });
  }, []);

  return (
    <div className="size-full" style={{ position: 'relative' }}>
      <CanvasGrid />
      <Tldraw
        shapeUtils={customShapeUtils}
        snapshot={initialSnapshot}
        onMount={handleMount}
        components={tldrawUiComponents}
      >
        <ToolsBridge />
        <EmptyCanvasHint />
        {/* CanvasMap mounts INSIDE Tldraw so useEditor()+useValue() can
            subscribe to viewport + shape state without manual store-listen.
            It positions itself absolutely against this Tldraw container. */}
        <CanvasMap />
      </Tldraw>
    </div>
  );
}

/**
 * Strip tldraw's built-in chrome — OpenCanvas renders its own header
 * controls. The CollapsibleStylePanel replaces tldraw's StylePanel so
 * the right edge stays clear when nothing's selected.
 *
 * Spec: REPLICATION-PROMPT.md §13 — `Canvas.tsx`.
 */
const tldrawUiComponents: TLUiComponents = {
  MainMenu: null,
  MenuPanel: null,
  PageMenu: null,
  NavigationPanel: null,
  ZoomMenu: null,
  Minimap: null,
  SharePanel: null,
  TopPanel: null,
  DebugMenu: null,
  DebugPanel: null,
  HelpMenu: null,
  Toolbar: null,
  QuickActions: null,
  HelperButtons: null,
  StylePanel: CollapsibleStylePanel,
};

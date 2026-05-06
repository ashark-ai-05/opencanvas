import { Maximize2, Minus, Plus, RotateCcw } from 'lucide-react';
import { getEditor } from '../state/editor-ref';
import { useCanvasStats } from '../state/canvas-stats-store';

/**
 * Tldraw-powered zoom + fit + reset buttons rendered inline in the
 * header, so the canvas can be navigated without surfacing tldraw's
 * built-in chrome.
 *
 * Spec: REPLICATION-PROMPT.md §13 — `HeaderCanvasControls`.
 */
export function HeaderCanvasControls() {
  const zoom = useCanvasStats((s) => s.zoom);
  const zoomPct = Math.round(zoom * 100);
  return (
    <div className="flex items-center gap-1">
      <HeaderIconButton
        title="Zoom out"
        onClick={() => {
          const editor = getEditor();
          if (!editor) return;
          editor.zoomOut(undefined, { animation: { duration: 160 } });
        }}
      >
        <Minus className="size-3.5" />
      </HeaderIconButton>
      <button
        type="button"
        className="opencanvas-header-zoom-readout"
        title="Click to reset to 100%"
        aria-label={`Zoom ${zoomPct}% — click to reset to 100%`}
        onClick={() => {
          const editor = getEditor();
          if (!editor) return;
          editor.resetZoom(undefined, { animation: { duration: 220 } });
        }}
      >
        {zoomPct}%
      </button>
      <HeaderIconButton
        title="Zoom in"
        onClick={() => {
          const editor = getEditor();
          if (!editor) return;
          editor.zoomIn(undefined, { animation: { duration: 160 } });
        }}
      >
        <Plus className="size-3.5" />
      </HeaderIconButton>
      <HeaderIconButton
        title="Fit to canvas"
        onClick={() => {
          const editor = getEditor();
          if (!editor) return;
          editor.zoomToFit({ animation: { duration: 220 } });
        }}
      >
        <Maximize2 className="size-3.5" />
      </HeaderIconButton>
      <HeaderIconButton
        title="Reset view (1:1)"
        onClick={() => {
          const editor = getEditor();
          if (!editor) return;
          editor.resetZoom(undefined, { animation: { duration: 220 } });
        }}
      >
        <RotateCcw className="size-3.5" />
      </HeaderIconButton>
    </div>
  );
}

export function HeaderIconButton({
  onClick,
  title,
  pressed,
  children,
}: {
  onClick: () => void;
  title: string;
  pressed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={pressed ? 'true' : undefined}
      data-pressed={pressed ? 'true' : undefined}
      className="opencanvas-header-btn"
    >
      {children}
    </button>
  );
}

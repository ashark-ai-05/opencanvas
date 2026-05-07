import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCanvasHistory } from '../state/canvas-history-store';
import { useConversationsStore } from '../state/conversations-store';
import { getEditor } from '../state/editor-ref';
import { HeaderIconButton } from './HeaderCanvasControls';

/**
 * Coarse-grained canvas history scrubber.
 *
 * Header button (clock icon) toggles a side drawer listing every
 * stashed snapshot for the current conversation, newest-first.
 * Clicking an entry calls editor.loadSnapshot() to replay the canvas
 * to that point. The current state is auto-pushed first so the user
 * can always undo the time travel.
 *
 * Storage lives in canvas-history-store (localStorage-backed,
 * per-conversation, capped at 50 entries). Capture happens inside
 * Canvas.tsx's existing save listener with an 8s minimum gap so a
 * heavy edit burst becomes one entry, not many.
 */
export function HistoryScrubber() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <HeaderIconButton
        title="Canvas history"
        onClick={() => setOpen((v) => !v)}
        pressed={open}
      >
        <Clock className="size-3.5" />
      </HeaderIconButton>
      <AnimatePresence>
        {open && <Drawer onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  );
}

function Drawer({ onClose }: { onClose: () => void }) {
  const activeId = useConversationsStore((s) => s.activeId);
  const entries = useCanvasHistory(
    (s) => s.byConversation[activeId] ?? [],
  );

  // Hydrate on first mount in case Canvas hasn't done it yet (e.g.
  // the user opens the drawer before the canvas has fired its first
  // save).
  useEffect(() => {
    useCanvasHistory.getState().hydrate(activeId);
  }, [activeId]);

  // Newest first.
  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.ts - a.ts),
    [entries],
  );

  const handleRestore = (snapshot: unknown) => {
    const editor = getEditor();
    if (!editor) {
      toast.error('Canvas not ready');
      return;
    }
    // Snapshot the current state into history first so the restore
    // is reversible. This makes the scrubber feel safe — every click
    // is recoverable from the same panel.
    useCanvasHistory.getState().push(activeId, editor.getSnapshot());
    try {
      (
        editor as unknown as { loadSnapshot: (snap: unknown) => void }
      ).loadSnapshot(snapshot);
      toast('Canvas restored — current state saved as a new entry');
    } catch (e) {
      toast.error('Restore failed', {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const handleClear = () => {
    if (!confirm('Clear canvas history for this conversation?')) return;
    useCanvasHistory.getState().clear(activeId);
    toast('History cleared');
  };

  return (
    <motion.aside
      className="opencanvas-history-drawer"
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <header className="opencanvas-history-header">
        <span className="opencanvas-history-title">
          <Clock className="size-4" />
          <span>Canvas history</span>
          <span className="opencanvas-history-count">{sorted.length}</span>
        </span>
        <button
          type="button"
          className="opencanvas-history-clear"
          onClick={handleClear}
          disabled={sorted.length === 0}
          title="Clear history"
        >
          clear
        </button>
        <button
          type="button"
          className="opencanvas-chat-titlebar-btn"
          onClick={onClose}
          title="Close"
        >
          <X className="size-3.5" />
        </button>
      </header>
      <div className="opencanvas-history-body">
        {sorted.length === 0 && (
          <div className="opencanvas-history-empty">
            No snapshots yet. Edit the canvas — entries land here
            automatically every ~8s of activity.
          </div>
        )}
        {sorted.map((entry, i) => (
          <button
            key={entry.id}
            type="button"
            className="opencanvas-history-row"
            onClick={() => handleRestore(entry.snapshot)}
          >
            <span className="opencanvas-history-row-time">
              {formatRelative(entry.ts)}
            </span>
            <span className="opencanvas-history-row-abs">
              {new Date(entry.ts).toLocaleTimeString()}
            </span>
            {i === 0 && (
              <span className="opencanvas-history-row-tag">latest</span>
            )}
            <RotateCcw className="size-3 opencanvas-history-row-go" />
          </button>
        ))}
      </div>
    </motion.aside>
  );
}

function formatRelative(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'just now';
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

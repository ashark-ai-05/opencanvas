import { motion, useMotionValue, useDragControls } from 'framer-motion';
import React, { useEffect, useState } from 'react';
import { useParallax } from '../lib/motion/use-parallax';
import { GripVertical, Maximize2, Minimize2, Minus, X } from 'lucide-react';
import { ChatBrandMark } from './ChatBrandMark';
import { Chat } from './Chat';
import { ChatStatusBar } from './ChatStatusBar';
import { ChatOptionsMenu } from './ChatOptionsMenu';
import { useUiStore } from '../state/ui-store';

/**
 * Draggable floating chat shell. Hosts the existing <Chat /> body —
 * drag/resize/minimize/full are pure UI concerns, the streaming + tool
 * dispatch logic is unchanged.
 *
 * Modes (ui-store.chatWindow.mode):
 *   - 'open'       : full-size, draggable
 *   - 'minimized'  : titlebar only (body hidden via CSS)
 *   - 'collapsed'  : whole shell hidden — launcher bubble is shown instead
 *
 * fullMode toggles a wider variant for "give me the full thing" moments.
 *
 * Spec: REPLICATION-PROMPT.md §13.
 */
export function FloatingChat({ chatKey }: { chatKey: string }) {
  const chatWindow = useUiStore((s) => s.chatWindow);
  const setChatWindow = useUiStore((s) => s.setChatWindow);
  const chatBusy = useUiStore((s) => s.chatBusy);

  const x = useMotionValue(chatWindow.dragX);
  const y = useMotionValue(chatWindow.dragY);
  const dragControls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const titlebarParallax = useParallax({ maxTilt: 2, lift: false });

  // Toggle fullMode AND snap the drag offset back to (0, 0) so the
  // larger size always anchors at the visible bottom-right corner.
  // Without the snap, a user who dragged the chat upward and then
  // hit "expand" could end up with the title bar pushed above the
  // viewport — and no way to grab the restore button.
  const toggleFullMode = () => {
    const next = chatWindow.fullMode === 'full' ? 'normal' : 'full';
    x.set(0);
    y.set(0);
    setChatWindow({ fullMode: next, dragX: 0, dragY: 0 });
  };

  // Belt-and-braces: if persisted drag offsets came from a previous
  // session in a smaller window, clamp them to keep the title bar
  // reachable. Runs once per mount.
  // (Uses window.innerWidth/Height directly — framer's dragConstraints
  //  fires only during drag, so this catches the "open in a smaller
  //  monitor than where you last left it" case.)
  useEffect(() => {
    const safeMinX = -window.innerWidth + 120;
    const safeMaxX = 80;
    const safeMinY = -window.innerHeight + 120;
    const safeMaxY = 80;
    const cx = Math.max(safeMinX, Math.min(safeMaxX, x.get()));
    const cy = Math.max(safeMinY, Math.min(safeMaxY, y.get()));
    if (cx !== x.get() || cy !== y.get()) {
      x.set(cx);
      y.set(cy);
      setChatWindow({ dragX: cx, dragY: cy });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (chatWindow.mode === 'collapsed') {
    return null;
  }

  return (
    <motion.aside
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      // Keep the title bar reachable from any corner of the viewport.
      // The chat is anchored bottom-right; x/y are translate offsets,
      // so negative values move it up-left. We allow it to nearly
      // exit the screen but always reserve ~120px of overlap so the
      // title bar (with the restore button) is grabbable.
      dragConstraints={{
        left: -window.innerWidth + 120,
        top: -window.innerHeight + 120,
        right: 80,
        bottom: 80,
      }}
      onDragStart={() => setDragging(true)}
      onDragEnd={() => {
        setDragging(false);
        setChatWindow({ dragX: x.get(), dragY: y.get() });
      }}
      style={{ x, y, right: 24, bottom: 24 }}
      data-mode={chatWindow.mode}
      data-fullmode={chatWindow.fullMode}
      data-dragging={dragging ? 'true' : 'false'}
      data-streaming={chatBusy ? 'true' : 'false'}
      className="opencanvas-chat-floating"
    >
      <ChatStatusBar />
      <motion.header
        ref={titlebarParallax.ref as React.RefObject<HTMLElement>}
        className="opencanvas-chat-titlebar"
        onPointerDown={(e) => {
          // Only start a drag if the pointer isn't on a button —
          // otherwise the close/minimize buttons require a steady hand.
          if ((e.target as HTMLElement).closest('button')) return;
          dragControls.start(e);
        }}
        onDoubleClick={(e) => {
          // Skip the position-reset when the user is rapid-clicking
          // one of the title-bar buttons (minimize / maximize / close
          // / options menu). Without this guard, two quick clicks on
          // a button bubble up here as a double-click and teleport
          // the chat back to the bottom-right anchor mid-toggle.
          if ((e.target as HTMLElement).closest('button')) return;
          // Otherwise: reset position to (0, 0) — easy escape if the
          // chat ends up off-screen on a multi-monitor setup.
          x.set(0);
          y.set(0);
          setChatWindow({ dragX: 0, dragY: 0 });
        }}
        onPointerMove={titlebarParallax.bind.onPointerMove}
        onPointerLeave={titlebarParallax.bind.onPointerLeave}
        style={{
          rotateX: titlebarParallax.rotateX,
          rotateY: titlebarParallax.rotateY,
          transformPerspective: 1200,
        }}
      >
        <span className="opencanvas-chat-titlebar-grip">
          <GripVertical className="size-3.5" />
        </span>
        <ChatBrandMark active={chatBusy} />
        <span className="opencanvas-chat-titlebar-title">OpenCanvas</span>
        <div className="opencanvas-chat-titlebar-actions">
          <ChatOptionsMenu />
          <button
            type="button"
            className="opencanvas-chat-titlebar-btn"
            title={chatWindow.fullMode === 'full' ? 'Restore size' : 'Expand'}
            // stopPropagation so rapid clicks don't bubble up to the
            // title bar's pointer-down (drag start) or onDoubleClick
            // (position reset) handlers.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleFullMode();
            }}
          >
            {chatWindow.fullMode === 'full' ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            className="opencanvas-chat-titlebar-btn"
            title={chatWindow.mode === 'minimized' ? 'Expand' : 'Minimize'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setChatWindow({
                mode: chatWindow.mode === 'minimized' ? 'open' : 'minimized',
              });
            }}
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            className="opencanvas-chat-titlebar-btn"
            data-danger="true"
            title="Hide chat (launcher bubble stays)"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setChatWindow({ mode: 'collapsed' });
            }}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </motion.header>
      <div className="opencanvas-chat-body">
        <Chat key={chatKey} />
      </div>
    </motion.aside>
  );
}

/**
 * Bubble shown when the floating chat is collapsed. Click to restore.
 */
export function FloatingChatLauncher() {
  const chatWindow = useUiStore((s) => s.chatWindow);
  const setChatWindow = useUiStore((s) => s.setChatWindow);
  if (chatWindow.mode !== 'collapsed') return null;
  return (
    <button
      type="button"
      className="opencanvas-chat-launcher"
      onClick={() => setChatWindow({ mode: 'open' })}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: 'var(--color-accent)' }}
      />
      Open OpenCanvas
    </button>
  );
}

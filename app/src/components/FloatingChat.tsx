import { motion, useMotionValue, useDragControls } from 'framer-motion';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParallax } from '../lib/motion/use-parallax';
import { ChevronUp, GripVertical, Maximize2, Minimize2, Minus, X } from 'lucide-react';
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
  const asideRef = useRef<HTMLElement | null>(null);

  // Measure the chat's actual rect and nudge x/y just enough to bring
  // any off-viewport edge back in. Bottom-anchored layout means a
  // minimize → restore can grow the body upward past the viewport's
  // top edge; this is the canonical fix-up.
  const clampToViewport = useCallback(() => {
    const el = asideRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 20;
    let dx = 0;
    let dy = 0;
    if (rect.right > window.innerWidth - margin) {
      dx = window.innerWidth - margin - rect.right;
    }
    if (rect.left < margin) {
      // Left-edge correction wins over right-edge (title bar grip
      // sits on the left, so prefer keeping that grabbable).
      dx = margin - rect.left;
    }
    if (rect.bottom > window.innerHeight - margin) {
      dy = window.innerHeight - margin - rect.bottom;
    }
    if (rect.top < margin) {
      // Title bar sits at the top of the chat — prefer keeping it in
      // view over the bottom edge.
      dy = margin - rect.top;
    }
    if (dx === 0 && dy === 0) return;
    const nx = x.get() + dx;
    const ny = y.get() + dy;
    x.set(nx);
    y.set(ny);
    setChatWindow({ dragX: nx, dragY: ny });
  }, [x, y, setChatWindow]);

  // Toggle fullMode. The clamp effect below handles bringing the
  // larger variant back into view if the previous drag offset would
  // leave it partially off-screen — no need to hard-reset to (0, 0).
  const toggleFullMode = () => {
    const next = chatWindow.fullMode === 'full' ? 'normal' : 'full';
    setChatWindow({ fullMode: next });
  };

  // Clamp whenever the chat's effective bounding box can change:
  //   - mode flip (minimized ↔ open) changes height (restore grows
  //     the body upward from the bottom anchor — main bug path)
  //   - fullMode flip changes width
  //   - viewport resize changes the safe area
  // rAF waits one frame so the DOM reflects the new size before we
  // measure with getBoundingClientRect.
  useEffect(() => {
    const id = requestAnimationFrame(() => clampToViewport());
    return () => cancelAnimationFrame(id);
  }, [chatWindow.mode, chatWindow.fullMode, clampToViewport]);

  useEffect(() => {
    const onResize = () => clampToViewport();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampToViewport]);

  if (chatWindow.mode === 'collapsed') {
    return null;
  }

  return (
    <motion.aside
      ref={asideRef as React.RefObject<HTMLElement>}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      // Keep the title bar reachable from any corner of the viewport.
      // The chat is anchored bottom-right; x/y are translate offsets,
      // so negative values move it up-left. We allow it to nearly
      // exit the screen but always reserve ~120px of overlap so the
      // title bar (with the restore button) is grabbable. The
      // post-drag clamp below additionally measures the actual rect
      // — required when the chat shrinks (minimize) and then regrows
      // (restore), since constraints sized for the SMALLER variant
      // would leave the larger one partially off-screen.
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
        // Catch the case where the user released the drag at the
        // very edge of the constraint and the bounding rect is
        // technically partly off-screen — bring it back.
        requestAnimationFrame(() => clampToViewport());
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
            title={chatWindow.mode === 'minimized' ? 'Restore' : 'Minimize'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setChatWindow({
                mode: chatWindow.mode === 'minimized' ? 'open' : 'minimized',
              });
            }}
          >
            {chatWindow.mode === 'minimized' ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <Minus className="size-3.5" />
            )}
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

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, History, Database, Sparkles, Eraser, Rows3 } from 'lucide-react';
import { useUiStore } from '../state/ui-store';

/**
 * Three-dot menu in the chat titlebar. Surfaces actions that don't fit
 * a permanent button slot:
 *   - Open conversations history (dispatches a window event the App listens for)
 *   - Open sources panel
 *   - Open MCP sources panel (added in Polish D)
 *
 * Portaled to document.body so the menu escapes the titlebar's 3D
 * stacking context (titlebar has `transformPerspective + rotateX/Y`
 * from useParallax — without portaling, the menu inherits the tilt
 * and stays trapped at z-40 inside the titlebar's stacking context,
 * which traps clicks and lets chat content visually bleed through).
 *
 * Spec: REPLICATION-PROMPT.md §13 — `ChatOptionsMenu`.
 */
export function ChatOptionsMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const setSourcesOpen = useUiStore((s) => s.setSourcesOpen);
  const chatTabsVisible = useUiStore((s) => s.chatTabsVisible);
  const setChatTabsVisible = useUiStore((s) => s.setChatTabsVisible);

  // Compute viewport-relative position from the trigger button's rect
  // each time the menu opens. Re-run on scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 6, // 6px gap below the trigger
        right: window.innerWidth - rect.right, // pin menu right-edge to trigger's right-edge
      });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Click-outside: dismiss when the user clicks anywhere that isn't the
  // trigger or the menu itself. mousedown (not click) so we close before
  // a competing focus shift happens.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="opencanvas-chat-titlebar-btn"
        title="More"
        aria-label="More chat options"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <MoreHorizontal className="size-3.5" />
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            top: coords.top,
            right: coords.right,
            minWidth: 192,
            padding: 6,
            borderRadius: 10,
            // Near-opaque so anything underneath doesn't bleed through.
            background: 'rgb(var(--color-glass-rgb) / 0.96)',
            border: '1px solid var(--color-line-2)',
            backdropFilter: 'var(--blur-medium)',
            WebkitBackdropFilter: 'var(--blur-medium)',
            boxShadow: 'var(--depth-3-shadow)',
            // Above DepthPanel backdrops (50) + asides (51) so the menu
            // sits on top of any open drawer too.
            zIndex: 60,
          }}
        >
          <MenuRow
            icon={<Rows3 className="size-3.5" />}
            label={chatTabsVisible ? 'Hide canvas tabs' : 'Show canvas tabs'}
            onClick={() => {
              setOpen(false);
              setChatTabsVisible(!chatTabsVisible);
            }}
          />
          <MenuRow
            icon={<History className="size-3.5" />}
            label="Conversation history"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new Event('opencanvas:open-history'));
            }}
          />
          <MenuRow
            icon={<Database className="size-3.5" />}
            label="Sources"
            onClick={() => {
              setOpen(false);
              setSourcesOpen(true);
            }}
          />
          <MenuRow
            icon={<Sparkles className="size-3.5" />}
            label="MCP servers"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new Event('opencanvas:open-mcp'));
            }}
          />
          <MenuRow
            icon={<Eraser className="size-3.5" />}
            label="Clear messages"
            onClick={() => {
              setOpen(false);
              // Clears the CURRENT conversation's messages without
              // creating a new conversation. Chat.tsx listens for this
              // event and calls useChat's setMessages([]).
              window.dispatchEvent(new Event('opencanvas:clear-chat'));
            }}
          />
        </div>,
        document.body,
      )}
    </>
  );
}

function MenuRow({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        width: '100%',
        padding: '7px 10px',
        borderRadius: 6,
        background: 'transparent',
        border: 'none',
        color: 'var(--color-fg-2)',
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          'rgba(255,255,255,0.05)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      <span style={{ color: 'var(--color-accent)' }}>{icon}</span>
      {label}
    </button>
  );
}

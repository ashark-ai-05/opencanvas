import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { useConversationsStore } from '../state/conversations-store';
import { getEditor } from '../state/editor-ref';
import { appendShapeToConversation } from '../canvas/persistence';

/**
 * Lazily-created singleton portal container. Using a stable child element
 * of document.body (rather than body itself) avoids the jsdom removeChild
 * conflict that occurs when @testing-library/react unmounts a component whose
 * createPortal target is document.body directly.
 */
function getPortalContainer(): HTMLElement {
  const id = '__oc-send-portal__';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    document.body.appendChild(el);
  }
  return el;
}

/**
 * "Send widget to another conversation" action.
 *
 * Renders a paper-airplane trigger button (styled as a CardActionButton) that
 * opens a portal popover listing all conversations except the active one.
 * Clicking a target conversation moves the shape there:
 *   1. Reads the full shape record from the current editor.
 *   2. Appends it into the target conversation's canvas snapshot via
 *      appendShapeToConversation (persistence layer — no backend round-trip).
 *   3. Deletes the shape from the current canvas.
 *   4. Shows a sonner toast with the target title + an "Open" button.
 *
 * The popover portals to a stable container div so it escapes the tldraw
 * shape's stacking context (same pattern as ChatOptionsMenu).
 */
export function SendWidgetMenu({ shapeId }: { shapeId: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  const conversations = useConversationsStore((s) => s.conversations);
  const activeId = useConversationsStore((s) => s.activeId);
  const selectOne = useConversationsStore((s) => s.selectOne);

  const others = conversations.filter((c) => c.id !== activeId);
  const disabled = others.length === 0;

  // Compute the popover's position from the trigger's bounding rect each time
  // it opens, and keep it updated on scroll/resize.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 6,
        left: rect.left,
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

  // Click-outside: close when the user clicks outside the trigger or the menu.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t))
        return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  const handleSend = (targetId: string, targetTitle: string) => {
    setOpen(false);
    const editor = getEditor();
    if (!editor) return;

    // Read the full shape from the current canvas.
    const shape = editor.getShape(shapeId as never);
    if (!shape) return;

    // Append to the target conversation's snapshot, then remove from current.
    appendShapeToConversation(targetId, shape as never);
    editor.deleteShapes([shapeId as never]);

    // Toast with optional "Open" action to jump to the destination.
    toast(`Moved to "${targetTitle}"`, {
      action: {
        label: 'Open',
        onClick: () => selectOne(targetId),
      },
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (!disabled) setOpen((v) => !v);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        title={
          disabled
            ? 'No other conversations to send to'
            : 'Send to another conversation'
        }
        aria-label={
          disabled
            ? 'No other conversations to send to'
            : 'Send to another conversation'
        }
        className="opencanvas-card-action"
        style={disabled ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
      >
        <Send className="size-3" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label="Send widget to conversation"
            style={{
              position: 'fixed',
              top: coords.top,
              left: coords.left,
              minWidth: 200,
              maxHeight: 320,
              overflowY: 'auto',
              padding: 6,
              borderRadius: 10,
              background: 'rgb(var(--color-glass-rgb) / 0.96)',
              border: '1px solid var(--color-line-2)',
              backdropFilter: 'var(--blur-medium)',
              WebkitBackdropFilter: 'var(--blur-medium)',
              boxShadow: 'var(--depth-3-shadow)',
              zIndex: 60,
            }}
          >
            {others.map((conv) => (
              <ConversationRow
                key={conv.id}
                title={conv.title}
                updatedAt={conv.updatedAt}
                onClick={() => handleSend(conv.id, conv.title)}
              />
            ))}
          </div>,
          getPortalContainer(),
        )}
    </>
  );
}

function ConversationRow({
  title,
  updatedAt,
  onClick,
}: {
  title: string;
  updatedAt: number;
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
        justifyContent: 'space-between',
        gap: 10,
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
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontSize: 11,
          opacity: 0.5,
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {relativeTime(updatedAt)}
      </span>
    </button>
  );
}

/** Compact relative timestamp: "just now", "5m ago", "2h ago", "3d ago". */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

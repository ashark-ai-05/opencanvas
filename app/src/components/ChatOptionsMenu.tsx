import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, History, Database, Sparkles } from 'lucide-react';
import { useUiStore } from '../state/ui-store';

/**
 * Three-dot menu in the chat titlebar. Surfaces actions that don't fit
 * a permanent button slot:
 *   - Open conversations history (dispatches a window event the App listens for)
 *   - Open sources panel
 *   - Open MCP sources panel (added in Polish D)
 *
 * Spec: REPLICATION-PROMPT.md §13 — `ChatOptionsMenu`.
 */
export function ChatOptionsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const setSourcesOpen = useUiStore((s) => s.setSourcesOpen);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
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
      {open && (
        <div
          className="opencanvas-glass"
          role="menu"
          style={{
            position: 'absolute',
            top: '110%',
            right: 0,
            minWidth: 192,
            padding: 6,
            borderRadius: 10,
            boxShadow: '0 16px 40px -12px rgba(0,0,0,0.6)',
            zIndex: 10,
          }}
        >
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
        </div>
      )}
    </div>
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
        fontSize: 12.5,
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

import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useConversationsStore } from '../state/conversations-store';
import { useUiStore } from '../state/ui-store';
import { useChatActions } from '../state/chat-actions-store';

/**
 * Horizontal tab strip shown between the chat titlebar and the chat body.
 * Each tab represents one conversation. Active tab is highlighted violet.
 * Double-click a tab title to rename inline (same pattern as ConversationsSidebar).
 * Visibility is toggled via ChatOptionsMenu → "Show/Hide tabs".
 */
export function ChatTabs() {
  const visible = useUiStore((s) => s.chatTabsVisible);
  if (!visible) return null;
  return <ChatTabsStrip />;
}

function ChatTabsStrip() {
  const conversations = useConversationsStore((s) => s.conversations);
  const activeId = useConversationsStore((s) => s.activeId);
  const selectOne = useConversationsStore((s) => s.selectOne);
  const deleteOne = useConversationsStore((s) => s.deleteOne);
  const renameOne = useConversationsStore((s) => s.renameOne);
  const newChat = useChatActions((s) => s.newChat);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingTitle, setPendingTitle] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Focus + select the rename input when entering edit mode.
  useEffect(() => {
    if (renamingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renamingId]);

  // Auto-scroll the active tab into view whenever activeId changes.
  // Guard required: jsdom does not implement scrollIntoView.
  useEffect(() => {
    const el = activeTabRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeId]);

  function commitRename(id: string) {
    renameOne(id, pendingTitle);
    setRenamingId(null);
  }

  function cancelRename() {
    setRenamingId(null);
  }

  function handleClose(id: string) {
    deleteOne(id);
  }

  function handleNewChat() {
    if (newChat) {
      newChat();
    } else {
      // Fallback: create directly via the conversations store
      useConversationsStore.getState().createNew();
    }
  }

  return (
    <div
      ref={stripRef}
      data-testid="chat-tabs-strip"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 12px',
        borderBottom: '1px solid var(--color-line)',
        overflowX: 'auto',
        scrollbarWidth: 'thin',
        flexShrink: 0,
      }}
    >
      {conversations.map((conv) => {
        const isActive = conv.id === activeId;
        const isRenaming = renamingId === conv.id;
        const truncatedTitle =
          conv.title.length > 14 ? conv.title.slice(0, 14) + '…' : conv.title;

        return (
          <div
            key={conv.id}
            ref={isActive ? activeTabRef : undefined}
            data-testid="chat-tab"
            data-active={isActive ? 'true' : 'false'}
            onClick={() => {
              if (isRenaming) return;
              selectOne(conv.id);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 10px',
              height: 26,
              borderRadius: 6,
              border: isActive
                ? '1px solid rgba(167,139,250,0.4)'
                : '1px solid var(--color-line)',
              background: isActive
                ? 'rgba(167,139,250,0.14)'
                : 'rgba(255,255,255,0.04)',
              color: isActive ? 'var(--color-fg)' : 'var(--color-fg-2)',
              fontSize: 11.5,
              cursor: 'pointer',
              flexShrink: 0,
              userSelect: 'none',
              transition: 'background 0.12s, border-color 0.12s',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLDivElement).style.background =
                  'rgba(255,255,255,0.08)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                (e.currentTarget as HTMLDivElement).style.background =
                  'rgba(255,255,255,0.04)';
              }
            }}
          >
            {isRenaming ? (
              <input
                ref={inputRef}
                type="text"
                value={pendingTitle}
                data-testid="tab-rename-input"
                onChange={(e) => setPendingTitle(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => commitRename(conv.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitRename(conv.id);
                  } else if (e.key === 'Escape') {
                    cancelRename();
                  }
                }}
                style={{
                  width: 90,
                  background: 'rgba(0,0,0,0.4)',
                  border: '1px solid rgba(167,139,250,0.4)',
                  borderRadius: 4,
                  color: 'var(--color-fg)',
                  fontSize: 11.5,
                  padding: '1px 4px',
                  outline: 'none',
                }}
              />
            ) : (
              <span
                data-testid="tab-title"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRenamingId(conv.id);
                  setPendingTitle(conv.title);
                }}
                title={conv.title.length > 14 ? conv.title : undefined}
                style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {truncatedTitle}
              </span>
            )}

            {/* Close button — only on inactive tabs, shown on hover via group */}
            {!isActive && !isRenaming && (
              <button
                type="button"
                data-testid="tab-close-btn"
                aria-label={`Close ${conv.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleClose(conv.id);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-fg-2)',
                  cursor: 'pointer',
                  padding: 0,
                  opacity: 0.6,
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = '1';
                  (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.1)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.opacity = '0.6';
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                <X style={{ width: 10, height: 10 }} />
              </button>
            )}
          </div>
        );
      })}

      {/* New conversation button */}
      <button
        type="button"
        data-testid="chat-tabs-new-btn"
        aria-label="New conversation"
        title="New conversation"
        onClick={handleNewChat}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          padding: '4px 8px',
          height: 26,
          borderRadius: 6,
          border: '1px solid var(--color-line)',
          background: 'rgba(255,255,255,0.04)',
          color: 'var(--color-fg-2)',
          fontSize: 11.5,
          cursor: 'pointer',
          flexShrink: 0,
          transition: 'background 0.12s',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            'rgba(255,255,255,0.10)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            'rgba(255,255,255,0.04)';
        }}
      >
        <Plus style={{ width: 12, height: 12 }} />
      </button>
    </div>
  );
}

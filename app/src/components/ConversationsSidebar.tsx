import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, X, MessageSquare } from 'lucide-react';
import { useConversationsStore } from '../state/conversations-store';
import { DepthPanel } from './primitives';

/**
 * Slide-in conversation list panel. Toggleable via App's "History" button.
 * Each row: title + relative-time + delete-on-hover. Click a row to switch.
 * Double-click a title to rename inline.
 */
export function ConversationsSidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <DepthPanel
      open={open}
      onClose={onClose}
      placement="left"
      width="320px"
      ariaLabel="Conversations"
    >
      <ConversationListBody onClose={onClose} />
    </DepthPanel>
  );
}

/**
 * The actual list body — was inline in the old motion.aside.
 * Lifted into its own component so the wrapper is just <DepthPanel>.
 */
function ConversationListBody({ onClose }: { onClose: () => void }) {
  const conversations = useConversationsStore((s) => s.conversations);
  const activeId = useConversationsStore((s) => s.activeId);
  const selectOne = useConversationsStore((s) => s.selectOne);
  const deleteOne = useConversationsStore((s) => s.deleteOne);
  const renameOne = useConversationsStore((s) => s.renameOne);
  const createNew = useConversationsStore((s) => s.createNew);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pendingTitle, setPendingTitle] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Focus the rename input when entering edit mode.
  useEffect(() => {
    if (renamingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renamingId]);

  // Sort by updatedAt desc so the most-recently-active sits at the top.
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <>
      <div className="flex items-center justify-between px-4 h-12 border-b border-white/5">
        <div className="flex items-center gap-2">
          <MessageSquare className="size-4 text-violet-400" />
          <h2 className="text-[13px] font-semibold tracking-tight text-zinc-100">
            Conversations
          </h2>
          <span className="text-[10.5px] text-zinc-500">
            {conversations.length}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors"
        >
          <X className="size-4" />
        </button>
      </div>

      <button
        onClick={() => {
          createNew();
          onClose();
        }}
        className="mx-3 mt-3 mb-1 px-3 h-9 rounded-lg flex items-center gap-2 text-[13px] font-medium opencanvas-btn-accent justify-center"
      >
        <Plus className="size-3.5" />
        New conversation
      </button>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {sorted.map((c) => {
          const isActive = c.id === activeId;
          const isRenaming = renamingId === c.id;
          return (
            <div
              key={c.id}
              onClick={() => {
                if (isRenaming) return;
                selectOne(c.id);
                onClose();
              }}
              className={
                'group relative px-3 py-2 rounded-md cursor-pointer flex flex-col gap-0.5 transition-colors ' +
                (isActive
                  ? 'bg-violet-500/12 border border-violet-500/30'
                  : 'border border-transparent hover:bg-white/3 hover:border-white/5')
              }
            >
              {isRenaming ? (
                <input
                  ref={inputRef}
                  type="text"
                  value={pendingTitle}
                  onChange={(e) => setPendingTitle(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => {
                    renameOne(c.id, pendingTitle);
                    setRenamingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      renameOne(c.id, pendingTitle);
                      setRenamingId(null);
                    } else if (e.key === 'Escape') {
                      setRenamingId(null);
                    }
                  }}
                  className="w-full bg-zinc-900/80 border border-violet-400/40 text-[13px] text-zinc-100 px-2 py-1 rounded focus:outline-none focus:border-violet-400"
                />
              ) : (
                <>
                  <div
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(c.id);
                      setPendingTitle(c.title);
                    }}
                    className="text-[13px] text-zinc-100 truncate font-medium"
                    title="Double-click to rename"
                  >
                    {c.title}
                  </div>
                  <div className="flex items-center gap-2 text-[10.5px] text-zinc-500">
                    <span>{relativeTime(c.updatedAt)}</span>
                    {c.messages.length > 0 && (
                      <>
                        <span>·</span>
                        <span>
                          {c.messages.length}{' '}
                          {c.messages.length === 1 ? 'msg' : 'msgs'}
                        </span>
                      </>
                    )}
                  </div>
                </>
              )}

              {!isRenaming && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      conversations.length === 1 ||
                      window.confirm(`Delete "${c.title}"?`)
                    ) {
                      deleteOne(c.id);
                    }
                  }}
                  aria-label="Delete conversation"
                  title="Delete conversation"
                  className="absolute right-2 top-2 p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          );
        })}

        {conversations.length === 0 && (
          <div className="text-center text-zinc-500 text-[12px] py-12">
            No conversations yet.
          </div>
        )}
      </div>

      <div className="px-4 py-2.5 border-t border-white/5 text-[10.5px] text-zinc-500">
        Double-click a title to rename · ⌘ + click coming soon
      </div>
    </>
  );
}

/** "5 min ago" / "yesterday" / "Mar 14" formatting. */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return 'yesterday';
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

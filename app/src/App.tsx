import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { Plus, History } from 'lucide-react';
import { Canvas } from './canvas/Canvas';
import { Chat } from './components/Chat';
import { HealthBadge } from './components/HealthBadge';
import { ConversationsSidebar } from './components/ConversationsSidebar';
import { SourcesPanel } from './components/SourcesPanel';
import { KbBadge } from './components/KbBadge';
import { useCanvasStats } from './state/canvas-stats-store';
import { useChatActions } from './state/chat-actions-store';
import { useConversationsStore } from './state/conversations-store';
import { useKbStats } from './state/kb-stats-store';

export function App() {
  const widgetCount = useCanvasStats((s) => s.widgetCount);
  const newChat = useChatActions((s) => s.newChat);
  // activeId drives Canvas + Chat keys: switching conversations re-mounts
  // both with the new conversation's snapshot/messages.
  const activeId = useConversationsStore((s) => s.activeId);
  const conversationCount = useConversationsStore((s) => s.conversations.length);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  // Hydrate KB chunk total on mount so the header badge shows a real
  // number from frame zero. Subsequent updates come from the
  // /v1/index-conversation response (Chat fires it after each turn).
  const hydrateKb = useKbStats((s) => s.hydrate);
  useEffect(() => {
    fetch('/v1/sources/list')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { totalChunks?: number } | null) => {
        if (data && typeof data.totalChunks === 'number') {
          hydrateKb(data.totalChunks);
        }
      })
      .catch(() => {
        /* ignore — header just stays in placeholder state */
      });
  }, [hydrateKb]);

  return (
    <div className="flex h-full flex-col relative bg-[var(--color-bg)]">
      <header className="flex items-center justify-between px-5 h-12 shrink-0 strata-glass relative z-10 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Conversations"
            title="Conversations"
            className="inline-flex items-center justify-center size-7 rounded-md text-zinc-300 hover:text-white border border-white/8 hover:border-white/15 transition-colors"
            style={{ background: 'rgba(255,255,255,0.03)' }}
          >
            <History className="size-3.5" />
          </button>
          {/* Mark — small square with the gradient, then wordmark */}
          <div
            aria-hidden
            className="size-5 rounded-md bg-gradient-to-br from-violet-400 to-fuchsia-400"
            style={{
              boxShadow:
                '0 0 0 1px rgba(255,255,255,0.06) inset, 0 4px 14px -4px rgba(167,139,250,0.6)',
            }}
          />
          <h1 className="text-[15px] font-semibold tracking-tight text-zinc-100">
            Strata
          </h1>
          {widgetCount > 0 && (
            <span
              className="ml-1 px-2 py-0.5 rounded-md text-[10.5px] font-medium tracking-wide text-zinc-400 border border-white/5"
              style={{ background: 'rgba(255,255,255,0.03)' }}
              title={`${widgetCount} widget${widgetCount === 1 ? '' : 's'} on canvas`}
            >
              {widgetCount} {widgetCount === 1 ? 'widget' : 'widgets'}
            </span>
          )}
          {conversationCount > 1 && (
            <span
              className="px-2 py-0.5 rounded-md text-[10.5px] font-medium tracking-wide text-zinc-500 border border-white/5"
              style={{ background: 'rgba(255,255,255,0.02)' }}
              title={`${conversationCount} conversations`}
            >
              {conversationCount} chats
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <KbBadge onClick={() => setSourcesOpen(true)} />
          <button
            type="button"
            onClick={() => newChat?.()}
            disabled={!newChat}
            title="Start a new conversation (current one stays in History)"
            className="inline-flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12px] font-medium text-zinc-300 hover:text-white border border-white/8 hover:border-white/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: 'rgba(255,255,255,0.03)' }}
          >
            <Plus className="size-3" />
            New
          </button>
          <HealthBadge />
        </div>
      </header>
      <main className="flex-1 min-h-0 grid grid-rows-[1fr_minmax(200px,34%)]">
        <section className="min-h-0 overflow-hidden border-b border-white/5 relative bg-[var(--color-bg)]">
          {/* key=activeId forces a clean remount when the user switches
              conversations, so the tldraw editor hydrates with the new
              snapshot rather than trying to mutate in-place. */}
          <Canvas key={activeId} />
        </section>
        <section className="min-h-0 overflow-hidden bg-[var(--color-bg)]">
          <Chat key={activeId} />
        </section>
      </main>
      <ConversationsSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <SourcesPanel open={sourcesOpen} onClose={() => setSourcesOpen(false)} />
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: 'rgba(10, 10, 13, 0.85)',
            color: '#f4f4f5',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            backdropFilter: 'blur(14px)',
          },
        }}
      />
    </div>
  );
}

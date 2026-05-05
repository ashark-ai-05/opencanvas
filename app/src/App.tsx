import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { History, Plus, ServerCog, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Canvas } from './canvas/Canvas';
import { FloatingChat, FloatingChatLauncher } from './components/FloatingChat';
import { getEditor } from './state/editor-ref';
import { useTemplateStore } from './state/template-store';
import { HealthBadge } from './components/HealthBadge';
import { ConversationsSidebar } from './components/ConversationsSidebar';
import { SourcesPanel } from './components/SourcesPanel';
import { McpSourcesPanel } from './components/McpSourcesPanel';
import { KbBadge } from './components/KbBadge';
import { HeaderCanvasControls } from './components/HeaderCanvasControls';
import { HeaderDrawTools } from './components/HeaderDrawTools';
import { useCanvasStats } from './state/canvas-stats-store';
import { useChatActions } from './state/chat-actions-store';
import { useConversationsStore } from './state/conversations-store';
import { useKbStats } from './state/kb-stats-store';
import { useUiStore } from './state/ui-store';

/**
 * Top-level layout — full-bleed canvas with a glass header on top and a
 * draggable floating chat panel on top of that. Drawer panels
 * (ConversationsSidebar / SourcesPanel / McpSourcesPanel) slide in from
 * either edge.
 *
 * Drawer state lives in `ui-store` (sourcesOpen) and local useState
 * (sidebarOpen, mcpOpen) — separated because the latter two are only
 * triggered by the header button or the chat options menu, while
 * sources is pinged from KbBadge.
 *
 * Spec: REPLICATION-PROMPT.md §13.
 */
export function App() {
  const widgetCount = useCanvasStats((s) => s.widgetCount);
  const newChat = useChatActions((s) => s.newChat);
  // activeId drives Canvas + Chat keys: switching conversations re-mounts
  // both with the new conversation's snapshot/messages.
  const activeId = useConversationsStore((s) => s.activeId);
  const conversationCount = useConversationsStore((s) => s.conversations.length);
  const sourcesOpen = useUiStore((s) => s.sourcesOpen);
  const setSourcesOpen = useUiStore((s) => s.setSourcesOpen);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);

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

  // Custom events let the chat options menu open the drawers without
  // prop drilling through Chat / FloatingChat.
  useEffect(() => {
    const onOpenHistory = () => setSidebarOpen(true);
    const onOpenMcp = () => setMcpOpen(true);
    window.addEventListener('opencanvas:open-history', onOpenHistory);
    window.addEventListener('opencanvas:open-mcp', onOpenMcp);
    return () => {
      window.removeEventListener('opencanvas:open-history', onOpenHistory);
      window.removeEventListener('opencanvas:open-mcp', onOpenMcp);
    };
  }, []);

  return (
    <div className="flex h-full flex-col relative bg-[var(--color-bg)]">
      <header className="flex items-center justify-between px-4 h-12 shrink-0 opencanvas-glass relative z-20 border-b border-white/5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Conversations"
            title="Conversations"
            className="opencanvas-header-btn"
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
            OpenCanvas
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
          <span className="opencanvas-header-divider" aria-hidden />
          <HeaderCanvasControls />
          <span className="opencanvas-header-divider" aria-hidden />
          <HeaderDrawTools />
          <button
            type="button"
            onClick={async () => {
              const editor = getEditor();
              if (!editor) return;
              const tplId = useTemplateStore.getState().activeTemplateId;
              const widgetCount = editor
                .getCurrentPageShapes()
                .filter((s) => s.type.startsWith('opencanvas:')).length;
              if (widgetCount === 0) {
                toast('Canvas is already empty');
                return;
              }
              const { applyToolDirective } = await import(
                './canvas/dispatcher'
              );
              applyToolDirective(editor, { type: 'clear' }, tplId);
              toast(
                `Cleared ${widgetCount} widget${widgetCount === 1 ? '' : 's'}`,
              );
            }}
            title="Clear all widgets from the canvas"
            aria-label="Clear canvas"
            className="opencanvas-header-btn opencanvas-header-btn--danger"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <KbBadge onClick={() => setSourcesOpen(true)} />
          <button
            type="button"
            onClick={() => setMcpOpen(true)}
            title="MCP servers"
            className="opencanvas-header-btn"
            aria-label="MCP servers"
          >
            <ServerCog className="size-3.5" />
          </button>
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
      <main className="flex-1 min-h-0 relative bg-[var(--color-bg)]">
        {/* key=activeId forces a clean remount when the user switches
            conversations, so the tldraw editor hydrates with the new
            snapshot rather than trying to mutate in-place. */}
        <Canvas key={activeId} />
      </main>
      <FloatingChat chatKey={activeId} />
      <FloatingChatLauncher />
      <ConversationsSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <SourcesPanel open={sourcesOpen} onClose={() => setSourcesOpen(false)} />
      <McpSourcesPanel open={mcpOpen} onClose={() => setMcpOpen(false)} />
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

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Send, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { applyToolDirective } from '../canvas/dispatcher';
import { getLatestSnapshot } from '../state/snapshot-ref';
import { getEditor } from '../state/editor-ref';
import { useTemplateStore } from '../state/template-store';
import { collectAppliedToolCallIds } from './chat-persistence';
import { suggestCommands, tryRunCommand } from './slash-commands';
import { TeamProgress, TeamHandoff } from './TeamProgress';
import { search as searchKb, type SearchResult } from '../api/search';
// KbHits + InlineLiveStep stay in the codebase but the floating panels are
// gone — their content now sits in <ComposerStatus /> next to the input.
import { deriveStep } from './LiveStatus';
import { ShowThinking } from './ShowThinking';
import { ComposerStatus } from './ComposerStatus';
import { EmptyChatBanner } from './EmptyChatBanner';
import { useChatActions } from '../state/chat-actions-store';
import { useConversationsStore } from '../state/conversations-store';
import { useKbStats } from '../state/kb-stats-store';
import { useUiStore } from '../state/ui-store';
import type { ToolDirective } from '../../../src/agent/types';

/**
 * AI SDK 6 surfaces UIMS tool chunks as parts shaped:
 *   { type: 'tool-<toolName>' | 'dynamic-tool',
 *     state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error',
 *     toolCallId, input?, output?, errorText? }
 */
type ToolPart = {
  type: string;
  state?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

/** Per-widget-kind emoji used in the chat anchor chip. */
const ANCHOR_EMOJI: Record<string, string> = {
  markdown: '📝',
  'code-block': '💻',
  ticket: '🎫',
  'web-embed': '🌐',
  'key-value-card': '🔑',
  table: '📊',
  timeline: '⏳',
  'file-tree': '🌳',
  composite: '🧩',
  tasks: '✅',
  kanban: '📋',
  'sticky-note': '📒',
};

/**
 * Peel the place_widget tool-result envelope and return the anchor data
 * we need to render a clickable chip. Returns null if the result wasn't
 * a successful place directive (e.g. update / focus / clear / link, or
 * a different tool's output entirely).
 *
 * Output shape from place_widget (src/agent/tools/place-widget.ts):
 *   { content: [{ type: 'text', text: '{ ok: true, id, directive: {...} }' }] }
 *
 * Various transports nest this inside output{} or content[] envelopes;
 * peel up to 5 layers to be safe.
 */
function describePlaceAnchor(part: ToolPart): {
  id: string;
  kind: string;
  title: string;
} | null {
  // Only render anchors for tools that actually placed a widget.
  const name = toolPartName(part);
  if (name !== 'place_widget') return null;
  let cur: unknown = part.output;
  for (let i = 0; i < 6; i++) {
    if (cur === null || cur === undefined) return null;
    if (typeof cur === 'string') {
      try {
        cur = JSON.parse(cur);
        continue;
      } catch {
        return null;
      }
    }
    if (typeof cur !== 'object') return null;
    const obj = cur as Record<string, unknown>;
    if (
      typeof obj['id'] === 'string' &&
      obj['directive'] &&
      typeof obj['directive'] === 'object'
    ) {
      const d = obj['directive'] as Record<string, unknown>;
      const id = (d['id'] as string) || (obj['id'] as string);
      const kind = (d['kind'] as string) || 'widget';
      const payload = (d['payload'] as Record<string, unknown>) ?? {};
      const title =
        (typeof payload['title'] === 'string' && (payload['title'] as string)) ||
        (typeof payload['ticketId'] === 'string' && (payload['ticketId'] as string)) ||
        (typeof payload['body'] === 'string'
          ? (payload['body'] as string).slice(0, 40)
          : kind);
      return { id, kind, title };
    }
    if ('content' in obj && Array.isArray(obj['content'])) {
      const text = (obj['content'] as Array<{ type?: string; text?: string }>)
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('');
      cur = text;
      continue;
    }
    if ('output' in obj) {
      cur = obj['output'];
      continue;
    }
    if ('directive' in obj) {
      cur = { id: obj['id'], directive: obj['directive'] };
      continue;
    }
    return null;
  }
  return null;
}

function isToolPart(p: { type: string }): p is ToolPart {
  return p.type === 'dynamic-tool' || p.type.startsWith('tool-');
}

function toolPartName(p: ToolPart): string {
  if (p.type === 'dynamic-tool') return p.toolName ?? 'unknown';
  const raw = p.type.slice('tool-'.length);
  const last = raw.split('__').pop();
  return last && last.length > 0 ? last : raw;
}

/**
 * Compact human-readable preview of a tool's input for the indicator.
 * Picks well-known keys per tool, truncates to 50 chars. Returns null when
 * the input is unstructured or empty.
 */
function describeToolInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  // Common search/lookup keys, in priority order
  const keys = ['query', 'q', 'path', 'id', 'url', 'pattern', 'name'];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) {
      return truncate(`${k}: ${v}`, 64);
    }
  }
  // Fallback for place_widget — show kind+role
  if (typeof obj['kind'] === 'string' && typeof obj['role'] === 'string') {
    return `${obj['kind']} (${obj['role']})`;
  }
  return null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Fire-and-forget POST to /v1/index-conversation. OpenCanvas's compounding-
 * value mechanic — every assistant turn becomes searchable for future
 * search_kb calls. Toasts the indexed chunk count on success so the user
 * sees the KB literally growing as they use the product.
 */
async function indexConversation(
  conversationId: string,
  messages: ReadonlyArray<{
    id: string;
    role: string;
    parts: ReadonlyArray<{ type: string; text?: string }>;
  }>,
): Promise<void> {
  try {
    const res = await fetch('/v1/index-conversation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId, messages }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { indexed?: number; delta?: number };
    const indexed = data.indexed ?? 0;
    const delta = Math.max(0, data.delta ?? indexed);
    if (delta > 0) {
      // Drive the header KB badge animation. `delta` is the net change
      // vs prior state — re-indexing a conversation that grew from 3 to
      // 5 turns bumps by 2, not 5. Toast as a secondary confirmation
      // in case the user isn't looking at the header.
      useKbStats.getState().bump(delta);
      toast(`KB grew · ${delta} new ${delta === 1 ? 'turn' : 'turns'} indexed`, {
        duration: 2400,
      });
    }
  } catch (e) {
    // Best-effort; don't bother the user with toasts on failure.
    console.warn('[chat] index-conversation failed:', e);
  }
}

function parseToolOutput(
  output: unknown,
): { directive: ToolDirective } | null {
  let value: unknown = output;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'directive' in value &&
    typeof (value as { directive?: unknown }).directive === 'object' &&
    (value as { directive?: unknown }).directive !== null
  ) {
    return value as { directive: ToolDirective };
  }
  return null;
}

export function Chat() {
  // Active-conversation-driven hydration. App.tsx re-mounts <Chat /> via
  // `key={activeId}` when the user switches threads, so it's safe to read
  // the active conversation once at mount and never look back.
  const { activeId, initialMessages } = useMemo(() => {
    const s = useConversationsStore.getState();
    const conv = s.getActive();
    return { activeId: conv.id, initialMessages: conv.messages };
  }, []);

  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: '/v1/chat',
      body: () => ({ canvasSnapshot: getLatestSnapshot() }),
      // Per-call URL override: the /team slash command sets metadata.route='team'
      // and we redirect to /v1/team. Default routing stays on /v1/chat.
      prepareSendMessagesRequest: ({ messages: msgs, requestMetadata, body, headers, credentials }) => {
        const meta = requestMetadata as { route?: string } | undefined;
        const api = meta?.route === 'team' ? '/v1/team' : '/v1/chat';
        return {
          api,
          body: { ...body, messages: msgs },
          headers,
          credentials,
        };
      },
    }),
  });
  const [input, setInput] = useState('');
  const isStreaming = status === 'streaming' || status === 'submitted';

  // Parallel KB search: every chat submit also fires `/v1/search` so we
  // can show the user the raw hits the agent will reason over. The agent
  // still runs its own `search_kb` tool with semantic-variant queries —
  // this is a UX layer on top of the SAME index, not a duplicate query
  // path. Falls back silently on backend errors.
  const [kbHits, setKbHits] = useState<SearchResult[] | null>(null);
  const [kbBusy, setKbBusy] = useState(false);
  const [kbQuery, setKbQuery] = useState<string | null>(null);
  const kbSearch = (query: string) => {
    const q = query.trim();
    if (!q) return;
    setKbBusy(true);
    setKbQuery(q);
    searchKb(q, 5)
      .then((r) => setKbHits(r.results))
      .catch(() => setKbHits([]))
      .finally(() => setKbBusy(false));
  };
  // Mirror streaming state into ui-store so the floating chat title bar
  // and composer status pill can react without prop drilling.
  useEffect(() => {
    useUiStore.getState().setChatBusy(isStreaming);
  }, [isStreaming]);
  // Pre-fill with toolCallIds from loaded history so we don't redispatch
  // directives the canvas already has from the prior session.
  const appliedRef = useRef<Set<string>>(
    new Set(collectAppliedToolCallIds(initialMessages)),
  );
  const errorShownRef = useRef<unknown>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Persist chat history into the active conversation on every change.
  // Cheap; no debounce needed at chat volume.
  useEffect(() => {
    useConversationsStore.getState().saveMessages(activeId, messages);
  }, [messages, activeId]);

  // Surface chat-level errors as a toast (network failure, 5xx, etc.) and
  // dedupe so the same Error doesn't fire repeatedly across re-renders.
  useEffect(() => {
    if (error && error !== errorShownRef.current) {
      errorShownRef.current = error;
      const message = error instanceof Error ? error.message : String(error);
      toast.error('Chat error', { description: message });
    }
  }, [error]);

  // Auto-scroll to bottom when new content streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Apply any directive that arrived in the stream to the tldraw canvas.
  useEffect(() => {
    const editor = getEditor();
    if (!editor) return;
    for (const m of messages) {
      for (const p of m.parts as Array<{ type: string }>) {
        if (!isToolPart(p)) continue;
        const op = p as ToolPart;
        if (op.state !== 'output-available') continue;
        if (!op.toolCallId) continue;
        if (appliedRef.current.has(op.toolCallId)) continue;
        const parsed = parseToolOutput(op.output);
        if (!parsed?.directive) {
          appliedRef.current.add(op.toolCallId);
          continue;
        }
        const tplId = useTemplateStore.getState().activeTemplateId;
        try {
          applyToolDirective(editor, parsed.directive, tplId);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error('[chat] applyToolDirective failed:', e);
          toast.error('Could not place widget', { description: message });
        }
        appliedRef.current.add(op.toolCallId);
      }
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;
    // Slash commands (e.g. /clear, /template, /help) execute locally and
    // never reach the LLM. tryRunCommand returns true if it consumed the
    // input — even for unknown commands, so we don't accidentally send
    // "/typo" up as a chat message.
    if (tryRunCommand(input)) {
      setInput('');
      return;
    }
    kbSearch(input);
    sendMessage({ text: input });
    setInput('');
  };

  // Slash-suggestion popover — shows when input starts with "/".
  const slashSuggestions = useMemo(() => {
    const t = input.trim();
    if (!t.startsWith('/')) return null;
    // Hide once a space appears — we're past command name, into args.
    if (t.includes(' ')) return null;
    return suggestCommands(t.slice(1));
  }, [input]);

  // Register a "new chat" callback the header button + /clear command can
  // invoke. Now: spins up a fresh conversation in the store; <App> sees the
  // activeId change and re-mounts both Chat and Canvas with empty state.
  // (Previously this cleared messages in-place — but with multi-conversation
  //  state we want each "New" to be its own thread, not a wipe.)
  const setNewChat = useChatActions((s) => s.setNewChat);
  useEffect(() => {
    setNewChat(() => {
      useConversationsStore.getState().createNew();
      toast('New chat started');
    });
    return () => setNewChat(null);
  }, [setNewChat]);

  // /team — multi-agent orchestration. Same useChat instance, but the
  // request metadata routes the call to /v1/team (see transport above).
  const setSendTeam = useChatActions((s) => s.setSendTeam);
  useEffect(() => {
    setSendTeam((text: string) => {
      kbSearch(text);
      sendMessage({ text }, { metadata: { route: 'team' } });
    });
    return () => setSendTeam(null);
  }, [setSendTeam, sendMessage]);

  // "Clear messages" — fired by ChatOptionsMenu via window event so the
  // menu doesn't need a prop drill. Wipes the current conversation's
  // useChat state AND its persisted entry in conversations-store, but
  // keeps the conversation itself (no new thread is created — that's
  // what the +New button does). Canvas widgets are left alone.
  useEffect(() => {
    const onClear = () => {
      setMessages([]);
      // Reset KB-hits panel state so a stale chip doesn't linger.
      setKbHits(null);
      setKbQuery(null);
      // Persist the wipe so a re-mount doesn't restore the old messages.
      useConversationsStore.getState().saveMessages(activeId, []);
      toast('Messages cleared');
    };
    window.addEventListener('opencanvas:clear-chat', onClear);
    return () => window.removeEventListener('opencanvas:clear-chat', onClear);
  }, [setMessages, activeId]);

  // Self-improving KB: when a turn finishes (status returns to 'ready'
  // after streaming) and the last message is from the assistant, index
  // the conversation back into the SQLite store. Search_kb naturally
  // surfaces these chunks alongside indexed docs/code in future turns.
  const lastIndexedRef = useRef(0);
  useEffect(() => {
    if (status !== 'ready') return;
    if (messages.length <= lastIndexedRef.current) return;
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    lastIndexedRef.current = messages.length;
    void indexConversation(activeId, messages);
  }, [status, messages, activeId]);

  return (
    <div className="flex h-full flex-col relative">
      {/* Streaming shimmer at the very top of the panel — Vercel-style "the system is alive". */}
      <AnimatePresence>
        {isStreaming && (
          <motion.div
            className="opencanvas-header-pulse absolute top-0 left-0 right-0 z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>

      {/* Team-pipeline indicator — only renders when a /team run has emitted
          phase signals; auto-hides on plain chat turns. */}
      <TeamProgress messages={messages} />

      <div
        ref={scrollRef}
        className="opencanvas-chat-scroll flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-5"
      >
        {messages.length === 0 && (
          <EmptyChatBanner onSuggestion={(s) => setInput(s)} />
        )}

        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              // No `layout` prop — animating position on every streamed
              // chunk causes the conversation to jitter as text appears.
              // Plain opacity/translate-in on mount is enough.
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
              className="flex flex-col gap-1.5"
            >
              <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-semibold">
                {m.role === 'user' ? 'you' : 'opencanvas'}
              </div>
              {/* "Show thinking + sources" — collapsible per-message
                  panel that surfaces both reasoning chunks (type
                  'reasoning' parts from AI SDK v6) AND the KB hits the
                  agent considered for this turn. KB hits attach to the
                  LATEST assistant message only — older messages stay
                  clean since the ranked-list state isn't snapshotted
                  per-turn. */}
              {m.role === 'assistant' &&
                (() => {
                  const reasoningParts = (m.parts as Array<{
                    type: string;
                    text?: string;
                    state?: string;
                  }>).filter((p) => p.type === 'reasoning');
                  const text = reasoningParts
                    .map((p) => p.text ?? '')
                    .join('\n\n');
                  const stillStreaming = reasoningParts.some(
                    (p) => p.state === 'streaming',
                  );
                  // Only the most recent assistant message gets the
                  // current KB hits attached.
                  const isLatest =
                    m.id ===
                    [...messages].reverse().find((x) => x.role === 'assistant')
                      ?.id;
                  return (
                    <ShowThinking
                      reasoningText={text}
                      streaming={stillStreaming}
                      kbHits={isLatest ? kbHits : null}
                      kbQuery={isLatest ? kbQuery : null}
                      onPlaceHit={(hit) => {
                        const editor = getEditor();
                        if (!editor) return;
                        import('../canvas/dispatcher')
                          .then((mod) =>
                            mod.placeResultsOnCanvas(editor, [hit]),
                          )
                          .catch((e) => {
                            console.error('[chat] place from KB failed:', e);
                            toast.error('Could not place from KB');
                          });
                      }}
                    />
                  );
                })()}
              <div
                className={
                  m.role === 'user'
                    ? 'whitespace-pre-wrap text-zinc-50 leading-relaxed text-[14px] opencanvas-glass rounded-xl px-4 py-3'
                    : 'text-zinc-100 leading-relaxed text-[14px] opencanvas-markdown'
                }
              >
                {(m.parts as Array<{ type: string }>).map((p, i) => {
                  if (p.type === 'reasoning') {
                    // Rendered above as a collapsible ShowThinking block;
                    // suppress here so the inline body shows the user-facing
                    // text reply only.
                    return null;
                  }
                  if (p.type === 'text') {
                    const text = (p as unknown as { text: string }).text;
                    // User messages stay as plain pre-wrap (their typed
                    // input shouldn't be reinterpreted as markdown).
                    if (m.role === 'user') return <span key={i}>{text}</span>;
                    // Assistant messages render through ReactMarkdown +
                    // remarkGfm so headings, lists, fenced code, tables,
                    // links all show properly. Streaming-friendly: we
                    // re-render on every chunk; ReactMarkdown is fine
                    // with that scale of churn at chat volume.
                    return (
                      <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
                        {text}
                      </ReactMarkdown>
                    );
                  }
                  if (p.type === 'data-team-handoff') {
                    const h = (p as unknown as {
                      data: { from: string; to: string; message: string };
                    }).data;
                    return <TeamHandoff key={i} from={h.from} to={h.to} message={h.message} />;
                  }
                  if (p.type === 'data-team-phase') {
                    // Rendered by the TeamProgress timeline component; suppress
                    // here so it doesn't leak into the message body.
                    return null;
                  }
                  if (isToolPart(p)) {
                    const tp = p as ToolPart;
                    if (tp.state === 'input-available' || tp.state === 'input-streaming') {
                      const preview = describeToolInput(tp.input);
                      return (
                        <span
                          key={i}
                          className="block text-[12px] text-zinc-400 mt-2"
                        >
                          <span className="opencanvas-tool-spinner" />
                          <span>calling </span>
                          <span className="font-mono text-violet-300/80">{toolPartName(tp)}</span>
                          {preview && (
                            <span className="text-zinc-500">
                              {' '}
                              <span className="font-mono text-zinc-400">{preview}</span>
                            </span>
                          )}
                          <span className="text-zinc-500">…</span>
                        </span>
                      );
                    }
                    if (tp.state === 'output-error') {
                      return (
                        <span key={i} className="block text-[12px] text-red-400 mt-2">
                          <span>tool error (</span>
                          <span className="font-mono">{toolPartName(tp)}</span>
                          <span>): {tp.errorText ?? 'error'}</span>
                        </span>
                      );
                    }
                    // output-available: the directive was already applied
                    // to the canvas in the useEffect above. Render a
                    // clickable anchor chip so the user can click back
                    // to that widget on the canvas later in the
                    // conversation. Anchors are derived from the
                    // tool-result envelope (5-layer peel) so they stay
                    // accurate across team-route nested envelopes.
                    if (tp.state === 'output-available') {
                      const anchor = describePlaceAnchor(tp);
                      if (!anchor) return null;
                      return (
                        <button
                          key={i}
                          type="button"
                          className="opencanvas-widget-anchor"
                          title={`Focus ${anchor.kind} on canvas`}
                          onClick={() => {
                            const editor = getEditor();
                            if (!editor) return;
                            try {
                              applyToolDirective(
                                editor,
                                { type: 'focus', id: anchor.id },
                                useTemplateStore.getState().activeTemplateId,
                              );
                            } catch (e) {
                              console.warn('[chat] focus failed:', e);
                              toast('Widget no longer on the canvas');
                            }
                          }}
                        >
                          <span className="opencanvas-widget-anchor-emoji">
                            {ANCHOR_EMOJI[anchor.kind] ?? '🎨'}
                          </span>
                          <span className="opencanvas-widget-anchor-kind">
                            {anchor.kind}
                          </span>
                          <span className="opencanvas-widget-anchor-title">
                            {anchor.title}
                          </span>
                        </button>
                      );
                    }
                    return null;
                  }
                  return null;
                })}
                {/* Live step + KB hit count are surfaced in the composer
                    status row instead of inside the message body — keeps
                    progress next to the input where the user is typing. */}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

      </div>

      {/* KB hits and live progress live INSIDE the composer status row
          now (see ComposerStatus below the form). Click the hit-count
          chip to expand the full list as a popover. */}

      {/* Slash-command suggestion popover. Sits above the form. */}
      <AnimatePresence>
        {slashSuggestions && slashSuggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.14 }}
            className="absolute left-3 right-3 bottom-[64px] z-20 opencanvas-glass rounded-xl overflow-hidden shadow-2xl"
          >
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/5">
              Slash commands
            </div>
            <ul className="max-h-48 overflow-y-auto">
              {slashSuggestions.map((c) => (
                <li
                  key={c.name}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setInput(`/${c.name}${c.args ? ' ' : ''}`);
                  }}
                  className="px-3 py-2 cursor-pointer hover:bg-white/5 flex items-baseline gap-3"
                >
                  <span className="font-mono text-[13px] text-violet-300 flex-shrink-0">
                    /{c.name}
                    {c.args && <span className="text-zinc-500"> {c.args}</span>}
                  </span>
                  <span className="text-[12px] text-zinc-500 truncate">{c.description}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Composer status — only the KB-hit chip + popover lives here
          now. The live step has moved INSIDE the input field (see
          InputLiveOverlay below). */}
      <ComposerStatus
        query={kbQuery}
        hits={kbHits}
        kbBusy={kbBusy}
        onPlace={(hit) => {
          const editor = getEditor();
          if (!editor) return;
          import('../canvas/dispatcher')
            .then((m) => m.placeResultsOnCanvas(editor, [hit]))
            .catch((e) => {
              console.error('[chat] place from KB failed:', e);
              toast.error('Could not place from KB');
            });
        }}
        onDismissHits={() => {
          setKbHits(null);
          setKbQuery(null);
        }}
      />

      <form
        onSubmit={handleSubmit}
        className="px-3 py-3 flex gap-2 border-t border-white/5 bg-[var(--color-bg)]/95"
      >
        {(() => {
          const liveStep = deriveStep({
            isStreaming,
            kbBusy,
            messages: messages as Parameters<typeof deriveStep>[0]['messages'],
          });
          const showOverlay = !input.trim() && liveStep !== null;
          return (
            <div className="opencanvas-chat-input-wrap flex-1 relative">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  showOverlay
                    ? ''
                    : '✨ Ask OpenCanvas anything…'
                }
                disabled={isStreaming}
                data-busy={isStreaming || kbBusy ? 'true' : 'false'}
                className="opencanvas-chat-input w-full px-4 py-2.5 rounded-xl bg-[var(--color-bg-2)] border border-white/8 text-zinc-100 placeholder-zinc-500 text-[14px] focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/15 transition-all disabled:opacity-50"
              />
              {/* Live step rendered INSIDE the input where the placeholder
                  would otherwise be. Absolute-positioned over the input,
                  pointer-events: none so the user can still focus + type
                  through it. Hides the moment the user types anything,
                  giving the live progress the prime spot in the UI. */}
              <AnimatePresence mode="wait">
                {showOverlay && liveStep && (
                  <motion.div
                    key={liveStep.key}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={{ duration: 0.16 }}
                    className="opencanvas-input-step"
                    aria-hidden
                  >
                    <span className="opencanvas-input-step-emoji">
                      {liveStep.emoji}
                    </span>
                    <span className="opencanvas-input-step-label">
                      {liveStep.label}
                    </span>
                    <span className="opencanvas-live-status-dots">
                      <span /><span /><span />
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })()}
        {isStreaming ? (
          <button
            type="button"
            onClick={() => stop()}
            aria-label="Stop"
            className="px-3.5 py-2.5 rounded-xl bg-[var(--color-bg-3)] hover:bg-zinc-800 text-zinc-100 border border-white/8 transition-colors flex items-center justify-center"
            title="Stop generating"
          >
            <Square className="size-4" fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Send"
            className="px-3.5 py-2.5 rounded-xl opencanvas-btn-accent flex items-center justify-center"
          >
            <Send className="size-4" />
          </button>
        )}
      </form>
    </div>
  );
}

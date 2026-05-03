import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { Send, Square, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { applyToolDirective } from '../canvas/dispatcher';
import { getLatestSnapshot } from '../state/snapshot-ref';
import { getEditor } from '../state/editor-ref';
import { useTemplateStore } from '../state/template-store';
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
  const { messages, sendMessage, status, stop, error } = useChat({
    transport: new DefaultChatTransport({
      api: '/v1/chat',
      body: () => ({ canvasSnapshot: getLatestSnapshot() }),
    }),
  });
  const [input, setInput] = useState('');
  const isStreaming = status === 'streaming' || status === 'submitted';
  const appliedRef = useRef<Set<string>>(new Set());
  const errorShownRef = useRef<unknown>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
    sendMessage({ text: input });
    setInput('');
  };

  return (
    <div className="flex h-full flex-col relative">
      {/* Streaming shimmer at the very top of the panel — Vercel-style "the system is alive". */}
      <AnimatePresence>
        {isStreaming && (
          <motion.div
            className="strata-header-pulse absolute top-0 left-0 right-0 z-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center mt-12 px-6"
          >
            <div className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full strata-glass">
              <Sparkles className="size-3 text-violet-400" />
              <span className="text-[11px] tracking-wide text-zinc-400">Strata · agent-driven canvas</span>
            </div>
            <p className="text-[15px] text-zinc-200 font-medium tracking-tight">Ask anything about your knowledge.</p>
            <p className="text-[13px] text-zinc-500 mt-1.5">
              Search, drill in, place widgets. The canvas reshapes around your question.
            </p>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              layout="position"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
              className="flex flex-col gap-1.5"
            >
              <div className="text-[10px] uppercase tracking-[0.14em] text-zinc-500 font-semibold">
                {m.role === 'user' ? 'you' : 'strata'}
              </div>
              <div
                className={
                  m.role === 'user'
                    ? 'whitespace-pre-wrap text-zinc-50 leading-relaxed text-[14px] strata-glass rounded-xl px-4 py-3'
                    : 'whitespace-pre-wrap text-zinc-100 leading-relaxed text-[14px]'
                }
              >
                {(m.parts as Array<{ type: string }>).map((p, i) => {
                  if (p.type === 'text') {
                    return <span key={i}>{(p as unknown as { text: string }).text}</span>;
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
                          <span className="strata-tool-spinner" />
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
                    // output-available: directive applied silently in the useEffect.
                    return null;
                  }
                  return null;
                })}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* "Thinking…" indicator that fires the moment the user submits, before
            any streamed content arrives. Disappears once the first chunk lands. */}
        {isStreaming && messages[messages.length - 1]?.role === 'user' && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2.5 text-zinc-500 text-[12px]"
          >
            <span className="strata-streaming-pulse" />
            thinking…
          </motion.div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="px-3 py-3 flex gap-2 border-t border-white/5 bg-[var(--color-bg)]/95"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Strata anything…"
          disabled={isStreaming}
          className="flex-1 px-4 py-2.5 rounded-xl bg-[var(--color-bg-2)] border border-white/8 text-zinc-100 placeholder-zinc-500 text-[14px] focus:outline-none focus:border-violet-400/60 focus:ring-2 focus:ring-violet-500/15 transition-all disabled:opacity-50"
        />
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
            className="px-3.5 py-2.5 rounded-xl strata-btn-accent flex items-center justify-center"
          >
            <Send className="size-4" />
          </button>
        )}
      </form>
    </div>
  );
}

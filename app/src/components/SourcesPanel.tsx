import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Code2, FileText, MessagesSquare, Database, RefreshCw } from 'lucide-react';

type SourceItem = {
  id: string;
  chunkCount: number;
  lastIndexed: number | null;
  kinds: string[];
  category: 'code' | 'docs' | 'conversation' | 'other';
};

type SourcesResponse = {
  sources: SourceItem[];
  total: number;
  totalChunks: number;
};

const CATEGORY_META = {
  code: { label: 'Code', color: 'var(--role-detail)', Icon: Code2 },
  docs: { label: 'Docs', color: 'var(--role-related)', Icon: FileText },
  conversation: {
    label: 'Conversations',
    color: 'var(--role-primary)',
    Icon: MessagesSquare,
  },
  other: { label: 'External', color: 'var(--role-reference)', Icon: Database },
} as const;

/**
 * Slide-in panel showing every indexed source. Visualizes the KB
 * literally growing — chunk counts go up as the user indexes more
 * (via CLI) or as conversations index back automatically. Refreshes
 * each time the panel opens AND on a manual refresh button.
 */
export function SourcesPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [data, setData] = useState<SourcesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchedOnceRef = useRef(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch('/v1/sources/list');
      if (res.ok) {
        const json = (await res.json()) as SourcesResponse;
        setData(json);
      }
    } catch (e) {
      console.warn('[sources] fetch failed:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && !fetchedOnceRef.current) {
      fetchedOnceRef.current = true;
      void refresh();
    } else if (open) {
      // re-fetch silently when re-opened so chunk counts stay live
      void refresh();
    }
  }, [open]);

  // Group by category for display.
  const grouped = (data?.sources ?? []).reduce<Record<string, SourceItem[]>>(
    (acc, s) => {
      (acc[s.category] ??= []).push(s);
      return acc;
    },
    {},
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="fixed inset-0 z-30 bg-black/40"
          />
          <motion.aside
            initial={{ x: 340, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 340, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="strata-glass fixed right-0 top-0 bottom-0 z-40 w-[340px] flex flex-col border-l border-white/8"
            style={{ background: 'rgba(10, 10, 13, 0.92)' }}
          >
            <div className="flex items-center justify-between px-4 h-12 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Database className="size-4 text-violet-400" />
                <h2 className="text-[13px] font-semibold tracking-tight text-zinc-100">
                  Knowledge base
                </h2>
                {data && (
                  <span className="text-[10.5px] text-zinc-500">
                    {data.totalChunks} {data.totalChunks === 1 ? 'chunk' : 'chunks'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={refresh}
                  aria-label="Refresh"
                  title="Refresh source list"
                  className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors"
                  disabled={loading}
                >
                  <RefreshCw className={'size-3.5 ' + (loading ? 'animate-spin' : '')} />
                </button>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-white/5 transition-colors"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
              {!data && (
                <div className="text-center text-zinc-500 text-[12px] py-12">
                  Loading…
                </div>
              )}
              {data && data.sources.length === 0 && (
                <div className="text-center text-zinc-500 text-[12px] py-12 px-4">
                  <p>No sources indexed yet.</p>
                  <p className="mt-2 text-zinc-600 leading-relaxed">
                    Run <span className="font-mono text-zinc-400">pnpm cli --index ./docs</span> or
                    chat with Strata — every conversation indexes back here.
                  </p>
                </div>
              )}
              {(['code', 'docs', 'conversation', 'other'] as const).map((cat) => {
                const items = grouped[cat] ?? [];
                if (items.length === 0) return null;
                const meta = CATEGORY_META[cat];
                const Icon = meta.Icon;
                const groupChunks = items.reduce(
                  (acc, s) => acc + s.chunkCount,
                  0,
                );
                return (
                  <div key={cat}>
                    <div className="flex items-center gap-2 px-2 mb-1.5">
                      <Icon className="size-3" style={{ color: meta.color }} />
                      <span className="text-[10.5px] uppercase tracking-[0.1em] font-semibold text-zinc-400">
                        {meta.label}
                      </span>
                      <span className="text-[10.5px] text-zinc-500">
                        {items.length} · {groupChunks} chunks
                      </span>
                    </div>
                    <ul className="space-y-0.5">
                      {items.map((s) => (
                        <li
                          key={s.id}
                          className="px-2 py-1.5 rounded-md hover:bg-white/3 transition-colors flex flex-col gap-0.5"
                        >
                          <div
                            className="text-[12px] font-mono text-zinc-100 truncate"
                            title={s.id}
                          >
                            {prettyId(s.id)}
                          </div>
                          <div className="flex items-center gap-2 text-[10.5px] text-zinc-500">
                            <span>
                              {s.chunkCount}{' '}
                              {s.chunkCount === 1 ? 'chunk' : 'chunks'}
                            </span>
                            {s.lastIndexed && (
                              <>
                                <span>·</span>
                                <span>{relativeTime(s.lastIndexed)}</span>
                              </>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>

            <div className="px-4 py-2.5 border-t border-white/5 text-[10.5px] text-zinc-500 leading-relaxed">
              Conversations auto-index after each turn. Run
              <span className="text-zinc-400 font-mono"> --index </span>or
              <span className="text-zinc-400 font-mono"> --index-code </span>
              from the CLI to add docs/code.
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** Human-readable form: 'local-code:./src' → 'src', 'conversation:abc' → 'chat abc'. */
function prettyId(id: string): string {
  if (id.startsWith('local-code:')) return id.slice('local-code:'.length);
  if (id.startsWith('local:')) return id.slice('local:'.length);
  if (id.startsWith('conversation:')) {
    const tail = id.slice('conversation:'.length);
    // conversation IDs are conv-<base36>-<rand>, just show the suffix
    const m = tail.match(/^conv-[^-]+-(.+)$/);
    return `chat ${m ? m[1] : tail.slice(0, 8)}`;
  }
  return id;
}

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

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Brain, ChevronRight, Database, Loader2, Plus, ExternalLink } from 'lucide-react';
import type { SearchResult } from '../api/search';

/**
 * Collapsible "behind the scenes" block per assistant message.
 *
 * Originally just rendered reasoning chunks (AI SDK v6 reasoning parts)
 * but now also surfaces the KB hits the agent considered for the same
 * turn — gives the user a unified "what was the model thinking + what
 * was it looking at" view in one expand.
 *
 * Layout: a single chevron toggle. When open:
 *   - Reasoning text in mono font (if any)
 *   - "KB hits considered" sub-section listing the top results (if any)
 *
 * If both reasoning AND hits are empty, the component renders nothing.
 */
export function ShowThinking({
  reasoningText,
  streaming,
  kbHits,
  kbQuery,
  onPlaceHit,
}: {
  reasoningText: string;
  streaming: boolean;
  kbHits?: SearchResult[] | null;
  kbQuery?: string | null;
  onPlaceHit?: (hit: SearchResult) => void;
}) {
  const [open, setOpen] = useState(false);

  // While reasoning is streaming, keep the panel open so the user sees it
  // accumulate in real time. Once streaming finishes, leave the user's
  // current open/closed choice alone (don't snap closed under them).
  useEffect(() => {
    if (streaming) setOpen(true);
  }, [streaming]);

  const hasReasoning = reasoningText.trim().length > 0;
  const hasHits = (kbHits?.length ?? 0) > 0;
  if (!hasReasoning && !hasHits) return null;

  // Tailor the toggle label to whatever's inside.
  const label = (() => {
    if (hasReasoning && hasHits) return open ? 'Hide thinking + sources' : 'Show thinking + sources';
    if (hasReasoning) return open ? 'Hide thinking' : 'Show thinking';
    return open ? 'Hide sources considered' : 'Show sources considered';
  })();

  return (
    <div className="opencanvas-thinking">
      <button
        type="button"
        className="opencanvas-thinking-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="opencanvas-thinking-toggle-chevron">
          <ChevronRight className="size-3" />
        </span>
        {hasReasoning ? (
          <Brain className="size-3" style={{ color: 'var(--color-accent)' }} />
        ) : (
          <Database className="size-3" style={{ color: 'var(--color-accent)' }} />
        )}
        <span>{label}</span>
        {hasHits && (
          <span className="opencanvas-thinking-hit-count">
            {kbHits!.length} {kbHits!.length === 1 ? 'hit' : 'hits'}
          </span>
        )}
        {streaming && (
          <span className="opencanvas-thinking-toggle-streaming">
            <Loader2 className="size-3 animate-spin" /> still reasoning…
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="thinking-body"
            className="opencanvas-thinking-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.26, ease: [0.2, 0.8, 0.2, 1] },
              opacity: { duration: 0.18 },
            }}
            style={{ overflow: 'hidden' }}
          >
          {hasReasoning && (
            <pre className="opencanvas-thinking-reasoning">{reasoningText}</pre>
          )}
          {hasReasoning && hasHits && (
            <div className="opencanvas-thinking-divider">
              <Database className="size-3" /> Sources considered
              {kbQuery && <span className="opencanvas-thinking-query">for “{kbQuery}”</span>}
            </div>
          )}
          {hasHits && (
            <ul className="opencanvas-thinking-hits">
              {kbHits!.map((hit) => {
                const title =
                  (hit.shape && typeof hit.shape['title'] === 'string'
                    ? (hit.shape['title'] as string)
                    : null) ??
                  hit.provenance?.uri ??
                  hit.id;
                const snippet = readSnippet(hit);
                const uri = hit.provenance?.uri ?? '';
                const isUrl = /^https?:\/\//.test(uri);
                return (
                  <li key={hit.id} className="opencanvas-thinking-hit">
                    <div className="opencanvas-thinking-hit-head">
                      <span className="opencanvas-thinking-hit-kind">{hit.kind}</span>
                      <span className="opencanvas-thinking-hit-title">{title}</span>
                    </div>
                    {snippet && (
                      <div className="opencanvas-thinking-hit-snippet">{snippet}</div>
                    )}
                    <div className="opencanvas-thinking-hit-actions">
                      {onPlaceHit && (
                        <button
                          type="button"
                          onClick={() => onPlaceHit(hit)}
                          title="Place on canvas"
                        >
                          <Plus className="size-3" /> Place
                        </button>
                      )}
                      {isUrl && (
                        <a
                          href={uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Open ${uri}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="size-3" /> Open
                        </a>
                      )}
                      <span className="opencanvas-thinking-hit-source">
                        {hit.sourceId}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function readSnippet(hit: SearchResult): string {
  const s = hit.shape ?? {};
  if (typeof s['body'] === 'string') return truncate(s['body'] as string);
  if (typeof s['snippet'] === 'string') return truncate(s['snippet'] as string);
  if (Array.isArray(s['fields'])) {
    const fields = s['fields'] as Array<{ key?: string; value?: string }>;
    const body = fields.find((f) => f.key === 'body');
    if (body?.value) return truncate(body.value);
  }
  return '';
}
function truncate(text: string, max = 180): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

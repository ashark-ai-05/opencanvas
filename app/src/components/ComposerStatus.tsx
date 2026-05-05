import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, Plus, ExternalLink, Database, X } from 'lucide-react';
import type { SearchResult } from '../api/search';

/**
 * Composer status row — sits ABOVE the chat input inside the same form
 * container. The live step is now rendered INSIDE the input field
 * itself (see InputLiveOverlay in Chat.tsx), so this row hosts only
 * the KB hit count chip + its expandable popover.
 *
 * The row only renders when there's something to show. When idle the
 * composer is a plain input — no leftover chrome.
 */
export function ComposerStatus({
  query,
  hits,
  kbBusy,
  onPlace,
  onDismissHits,
}: {
  query: string | null;
  hits: SearchResult[] | null;
  kbBusy: boolean;
  onPlace: (hit: SearchResult) => void;
  onDismissHits: () => void;
}) {
  const [hitsOpen, setHitsOpen] = useState(false);

  const hitCount = hits?.length ?? null;
  const showHitsChip =
    query !== null && (kbBusy || (hitCount !== null && hitCount > 0));

  if (!showHitsChip) return null;

  return (
    <div className="opencanvas-composer-status-row">
      {showHitsChip && (
        <button
          type="button"
          className="opencanvas-composer-hits-chip"
          aria-expanded={hitsOpen}
          aria-label={`KB hits: ${hitCount ?? '…'}`}
          title={hitsOpen ? 'Hide KB hits' : 'Show KB hits'}
          onClick={() => setHitsOpen((v) => !v)}
        >
          <Database className="size-3" />
          <span>{kbBusy ? '…' : `${hitCount ?? 0} hit${hitCount === 1 ? '' : 's'}`}</span>
          <ChevronUp
            className="size-3"
            style={{
              transform: hitsOpen ? 'rotate(0deg)' : 'rotate(180deg)',
              transition: 'transform 200ms ease',
            }}
          />
        </button>
      )}
      <AnimatePresence>
        {hitsOpen && hits && hits.length > 0 && query && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.16 }}
            className="opencanvas-composer-hits-popover"
          >
            <div className="opencanvas-composer-hits-popover-header">
              <Database className="size-3" />
              <span>KB hits for “{query}”</span>
              <button
                type="button"
                className="opencanvas-composer-hits-popover-dismiss"
                onClick={(e) => {
                  e.stopPropagation();
                  onDismissHits();
                  setHitsOpen(false);
                }}
                aria-label="Dismiss KB hits"
                title="Dismiss"
              >
                <X className="size-3" />
              </button>
            </div>
            <ul className="opencanvas-composer-hits-list">
              {hits.map((hit) => {
                const title = readTitle(hit);
                const snippet = readSnippet(hit);
                const uri = hit.provenance?.uri ?? '';
                const isUrl = /^https?:\/\//.test(uri);
                return (
                  <li key={hit.id} className="opencanvas-composer-hits-row">
                    <div className="opencanvas-composer-hits-row-head">
                      <span className="opencanvas-composer-hits-row-kind">
                        {hit.kind}
                      </span>
                      <span className="opencanvas-composer-hits-row-title">
                        {title}
                      </span>
                    </div>
                    {snippet && (
                      <div className="opencanvas-composer-hits-row-snippet">
                        {snippet}
                      </div>
                    )}
                    <div className="opencanvas-composer-hits-row-actions">
                      <button
                        type="button"
                        title="Place on canvas"
                        onClick={() => {
                          onPlace(hit);
                          setHitsOpen(false);
                        }}
                      >
                        <Plus className="size-3" /> Place
                      </button>
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
                      <span className="opencanvas-composer-hits-row-source">
                        {hit.sourceId}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function readTitle(hit: SearchResult): string {
  const s = hit.shape ?? {};
  if (typeof s['title'] === 'string') return s['title'] as string;
  return hit.provenance?.uri ?? hit.id;
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

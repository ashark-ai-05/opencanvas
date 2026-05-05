import { Database, Loader2, X, Plus, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { SearchResult } from '../api/search';

/**
 * KB hits panel rendered above the chat composer.
 *
 * Every chat submit triggers a parallel `/v1/search` against the local
 * SQLite KB. The hits are surfaced here so the user can SEE what the
 * agent has to work with — and click any hit to drop a widget on the
 * canvas without waiting for the agent to do it. The agent ALSO runs
 * `search_kb` with semantic-variant queries in its own loop; this panel
 * is the user-facing view, not a duplicate query path.
 *
 * - busy + null hits → spinner pill ("searching…")
 * - empty hits → muted "no matches" pill
 * - non-empty hits → top-N clickable rows
 * - dismiss button clears the panel for this turn
 */
export function KbHits({
  query,
  hits,
  busy,
  onPlace,
  onDismiss,
}: {
  query: string | null;
  hits: SearchResult[] | null;
  busy: boolean;
  onPlace: (hit: SearchResult) => void;
  onDismiss: () => void;
}) {
  const visible = busy || hits !== null;
  return (
    <AnimatePresence>
      {visible && query && (
        <motion.div
          key={query}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.18 }}
          className="opencanvas-kb-hits"
        >
          <div className="opencanvas-kb-hits-header">
            <Database className="size-3" />
            <span className="opencanvas-kb-hits-label">
              {busy ? `Searching KB for “${query}”…` : `KB hits for “${query}”`}
            </span>
            {busy && <Loader2 className="size-3 animate-spin" />}
            <button
              type="button"
              className="opencanvas-kb-hits-dismiss"
              title="Hide KB hits"
              aria-label="Hide KB hits"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss();
              }}
            >
              <X className="size-3" />
            </button>
          </div>

          {!busy && hits && hits.length === 0 && (
            <div className="opencanvas-kb-hits-empty">
              No matches in your local KB. The agent may still answer from
              its model, web search, or external MCP sources.
            </div>
          )}

          {hits && hits.length > 0 && (
            <ul className="opencanvas-kb-hits-list">
              {hits.map((hit) => {
                const title = readTitle(hit);
                const snippet = readSnippet(hit);
                const uri = hit.provenance?.uri ?? '';
                const isUrl = /^https?:\/\//.test(uri);
                return (
                  <li key={hit.id} className="opencanvas-kb-hits-row">
                    <div className="opencanvas-kb-hits-row-head">
                      <span className="opencanvas-kb-hits-row-kind">
                        {hit.kind}
                      </span>
                      <span className="opencanvas-kb-hits-row-title">{title}</span>
                    </div>
                    {snippet && (
                      <div className="opencanvas-kb-hits-row-snippet">{snippet}</div>
                    )}
                    <div className="opencanvas-kb-hits-row-actions">
                      <button
                        type="button"
                        title="Place on canvas"
                        aria-label="Place on canvas"
                        onClick={() => onPlace(hit)}
                      >
                        <Plus className="size-3" /> Place
                      </button>
                      {isUrl && (
                        <a
                          href={uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Open ${uri}`}
                        >
                          <ExternalLink className="size-3" /> Open
                        </a>
                      )}
                      <span className="opencanvas-kb-hits-row-source">
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
  );
}

/**
 * Pull a title from the `shape` envelope returned by /v1/search.
 *
 * Backend returns `shape: Record<string, unknown>` whose contents depend
 * on the result kind — text-document has `title`/`body`; chat-message
 * has a key-value `fields` array. Fall through to provenance.uri.
 */
function readTitle(hit: SearchResult): string {
  const s = hit.shape ?? {};
  if (typeof s['title'] === 'string') return s['title'] as string;
  return hit.provenance?.uri ?? hit.id;
}

function readSnippet(hit: SearchResult): string {
  const s = hit.shape ?? {};
  if (typeof s['body'] === 'string') {
    return truncate(s['body'] as string);
  }
  if (typeof s['snippet'] === 'string') {
    return truncate(s['snippet'] as string);
  }
  if (Array.isArray(s['fields'])) {
    const fields = s['fields'] as Array<{ key?: string; value?: string }>;
    const body = fields.find((f) => f.key === 'body');
    if (body?.value) return truncate(body.value);
  }
  return '';
}

function truncate(text: string, max = 200): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

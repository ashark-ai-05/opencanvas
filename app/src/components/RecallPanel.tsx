import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X, LayoutGrid } from 'lucide-react';
import { toast } from 'sonner';
import { DepthPanel } from './primitives';
import { search as searchKb, type SearchResult } from '../api/search';
import { getEditor } from '../state/editor-ref';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DateRange = 'anytime' | 'today' | 'last7' | 'last30';

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: 'anytime', label: 'Anytime' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
];

// ResultKind values from the backend
const KIND_FILTERS = [
  'text-document',
  'wiki-page',
  'code-file',
  'code-symbol',
  'chat-message',
  'web-page',
] as const;

type KindFilter = (typeof KIND_FILTERS)[number];

// ---------------------------------------------------------------------------
// Public component — thin shell matching PluginsPanel / SchedulesPanel pattern
// ---------------------------------------------------------------------------

export interface RecallPanelProps {
  open: boolean;
  onClose: () => void;
}

export function RecallPanel({ open, onClose }: RecallPanelProps) {
  return (
    <DepthPanel
      open={open}
      onClose={onClose}
      placement="right"
      width="480px"
      ariaLabel="Recall"
    >
      <RecallPanelBody onClose={onClose} />
    </DepthPanel>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readTitle(hit: SearchResult): string {
  const s = hit.shape ?? {};
  if (typeof s['title'] === 'string') return s['title'] as string;
  return hit.provenance?.uri ?? hit.id;
}

function readSnippet(hit: SearchResult): string {
  const s = hit.shape ?? {};
  if (typeof s['body'] === 'string') {
    const body = s['body'] as string;
    return body.length > 180 ? body.slice(0, 180) + '…' : body;
  }
  if (typeof s['snippet'] === 'string') {
    const snippet = s['snippet'] as string;
    return snippet.length > 180 ? snippet.slice(0, 180) + '…' : snippet;
  }
  if (Array.isArray(s['fields'])) {
    const fields = s['fields'] as Array<{ key?: string; value?: string }>;
    const body = fields.find((f) => f.key === 'body');
    if (body?.value) {
      const v = body.value;
      return v.length > 180 ? v.slice(0, 180) + '…' : v;
    }
  }
  return '';
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  if (hours >= 1) return `${hours}h ago`;
  if (mins >= 1) return `${mins}m ago`;
  return 'just now';
}

function dateRangeFilter(hit: SearchResult, range: DateRange): boolean {
  if (range === 'anytime') return true;
  const fetchedAt = hit.provenance?.fetchedAt;
  if (!fetchedAt) return true;
  const now = Date.now();
  if (range === 'today') return now - fetchedAt < 86_400_000;
  if (range === 'last7') return now - fetchedAt < 7 * 86_400_000;
  if (range === 'last30') return now - fetchedAt < 30 * 86_400_000;
  return true;
}

// Place a search hit onto the current canvas using the same path as KbHits
function placeHitOnCanvas(hit: SearchResult): void {
  const editor = getEditor();
  if (!editor) {
    toast.error('No active canvas — open a conversation first');
    return;
  }
  import('../canvas/dispatcher')
    .then((m) => m.placeResultsOnCanvas(editor, [hit]))
    .then(() => toast.success('Placed on canvas'))
    .catch((e) => {
      console.error('[RecallPanel] place failed:', e);
      toast.error('Could not place on canvas');
    });
}

// ---------------------------------------------------------------------------
// Body sub-component
// ---------------------------------------------------------------------------

function RecallPanelBody({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeKinds, setActiveKinds] = useState<Set<KindFilter>>(new Set());
  const [dateRange, setDateRange] = useState<DateRange>('anytime');

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef('');

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    latestQueryRef.current = q;

    // Backend requires a non-empty query — gracefully show empty state hint
    if (!trimmed) {
      setLoading(false);
      setResults(null);
      return;
    }

    setLoading(true);
    try {
      const resp = await searchKb(trimmed, 50);
      // Guard against stale responses when user types quickly
      if (latestQueryRef.current !== q) return;
      setResults(resp.results);
    } catch {
      if (latestQueryRef.current !== q) return;
      setResults([]);
    } finally {
      if (latestQueryRef.current === q) setLoading(false);
    }
  }, []);

  // Initial search attempt on mount — try '*' as a browse query
  useEffect(() => {
    runSearch('*');
  }, [runSearch]);

  // Debounced re-search on input change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(query || '*');
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  // Client-side filtering
  const filtered = results
    ? results.filter((hit) => {
        if (activeKinds.size > 0 && !activeKinds.has(hit.kind as KindFilter)) {
          return false;
        }
        if (!dateRangeFilter(hit, dateRange)) return false;
        return true;
      })
    : null;

  const hasActiveFilters = activeKinds.size > 0 || dateRange !== 'anytime';

  function toggleKind(kind: KindFilter) {
    setActiveKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function clearFilters() {
    setActiveKinds(new Set());
    setDateRange('anytime');
  }

  const count = filtered?.length ?? 0;

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '14px 16px',
          borderBottom: '1px solid var(--color-line, rgba(255,255,255,0.06))',
          flexShrink: 0,
        }}
      >
        <Search className="size-4" style={{ color: 'var(--color-accent)' }} />
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--color-fg)',
          }}
        >
          Recall
        </h2>
        {filtered !== null && (
          <span
            style={{
              marginLeft: 4,
              padding: '1px 7px',
              borderRadius: 99,
              fontSize: 11,
              fontWeight: 500,
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--color-muted)',
              border: '1px solid rgba(255,255,255,0.07)',
            }}
          >
            {count}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close Recall"
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: 6,
            background: 'transparent',
            border: '1px solid transparent',
            color: 'var(--color-muted)',
            cursor: 'pointer',
          }}
        >
          <X className="size-3.5" />
        </button>
      </header>

      {/* ── Search input ───────────────────────────────────────────────── */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '1px solid var(--color-line, rgba(255,255,255,0.06))',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Search
            className="size-3.5"
            style={{
              position: 'absolute',
              left: 10,
              color: 'var(--color-muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across all conversations…"
            aria-label="Search across all conversations"
            style={{
              width: '100%',
              padding: '7px 10px 7px 30px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'var(--color-fg)',
              fontSize: 13,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* ── Filter chips ───────────────────────────────────────────────── */}
      <div
        style={{
          padding: '8px 16px',
          borderBottom: '1px solid var(--color-line, rgba(255,255,255,0.06))',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        {KIND_FILTERS.map((kind) => {
          const active = activeKinds.has(kind);
          return (
            <button
              key={kind}
              type="button"
              role="button"
              aria-label={kind}
              aria-pressed={active}
              onClick={() => toggleKind(kind)}
              style={{
                padding: '2px 8px',
                borderRadius: 5,
                fontSize: 11,
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                cursor: 'pointer',
                border: active
                  ? '1px solid rgba(167,139,250,0.4)'
                  : '1px solid rgba(255,255,255,0.08)',
                background: active
                  ? 'rgba(167,139,250,0.15)'
                  : 'rgba(255,255,255,0.04)',
                color: active ? '#ddd6fe' : 'var(--color-muted)',
                transition: 'all 0.12s',
              }}
            >
              {kind}
            </button>
          );
        })}

        {/* Date range dropdown */}
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRange)}
          aria-label="Date range filter"
          style={{
            padding: '2px 8px',
            borderRadius: 5,
            fontSize: 11,
            cursor: 'pointer',
            border:
              dateRange !== 'anytime'
                ? '1px solid rgba(167,139,250,0.4)'
                : '1px solid rgba(255,255,255,0.08)',
            background:
              dateRange !== 'anytime'
                ? 'rgba(167,139,250,0.15)'
                : 'rgba(255,255,255,0.04)',
            color: dateRange !== 'anytime' ? '#ddd6fe' : 'var(--color-muted)',
            appearance: 'none',
          }}
        >
          {DATE_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            style={{
              marginLeft: 'auto',
              padding: '2px 8px',
              borderRadius: 5,
              fontSize: 11,
              cursor: 'pointer',
              border: '1px solid rgba(255,255,255,0.08)',
              background: 'transparent',
              color: 'var(--color-muted)',
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Result list ────────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {/* Empty state — no query typed, no results yet */}
        {!loading && filtered === null && (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: 'var(--color-muted)',
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <LayoutGrid
              className="size-6"
              style={{ margin: '0 auto 8px', opacity: 0.4 }}
            />
            <p style={{ margin: 0 }}>
              Search to recall content from any conversation, or filter by type
              below.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div
            style={{
              padding: '24px 0',
              textAlign: 'center',
              color: 'var(--color-muted)',
              fontSize: 13,
            }}
          >
            Searching…
          </div>
        )}

        {/* No matches */}
        {!loading && filtered !== null && filtered.length === 0 && (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: 'var(--color-muted)',
              fontSize: 13,
            }}
          >
            {query.trim()
              ? `No matches for "${query}".`
              : 'No matches found.'}
          </div>
        )}

        {/* Hit rows */}
        {!loading &&
          filtered !== null &&
          filtered.map((hit) => (
            <HitRow key={hit.id} hit={hit} />
          ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// HitRow — one result card
// ---------------------------------------------------------------------------

function HitRow({ hit }: { hit: SearchResult }) {
  const title = readTitle(hit);
  const snippet = readSnippet(hit);
  const time = relativeTime(hit.provenance?.fetchedAt ?? Date.now());
  const sourceId = hit.sourceId ?? hit.id;

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 10,
        background: 'rgba(255,255,255,0.025)',
        border: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
      }}
    >
      {/* Top row: kind badge + source */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            padding: '1px 6px',
            borderRadius: 4,
            background: 'rgba(255,255,255,0.05)',
            color: '#ddd6fe',
            border: '1px solid rgba(167,139,250,0.18)',
            flexShrink: 0,
          }}
        >
          {hit.kind}
        </span>
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 240,
          }}
          title={sourceId}
        >
          {sourceId}
        </span>
      </div>

      {/* Middle: title + snippet */}
      <div>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--color-fg)',
            lineHeight: 1.35,
          }}
        >
          {title}
        </p>
        {snippet && (
          <p
            style={{
              margin: '3px 0 0',
              fontSize: 12,
              color: 'var(--color-fg-2, rgba(255,255,255,0.55))',
              lineHeight: 1.45,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {snippet}
          </p>
        )}
      </div>

      {/* Bottom: time + place button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 2,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: 'var(--color-muted)',
          }}
        >
          {time}
        </span>
        <button
          type="button"
          aria-label="Place on canvas"
          title="Place on canvas"
          onClick={() => placeHitOnCanvas(hit)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '3px 10px',
            borderRadius: 7,
            background: 'rgba(167,139,250,0.12)',
            border: '1px solid rgba(167,139,250,0.25)',
            color: '#ddd6fe',
            fontSize: 12,
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Place on canvas
        </button>
      </div>
    </div>
  );
}

import { useEditor } from 'tldraw';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { search } from '../api/search';
import { placeResultsOnCanvas } from '../canvas/dispatcher';

export function SearchBar() {
  const editor = useEditor();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;

    setBusy(true);
    setError(null);
    try {
      const { results } = await search(q, 10);
      placeResultsOnCanvas(editor, results);
      setQuery('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        position: 'absolute',
        top: 60,
        right: 12,
        zIndex: 200,
        display: 'flex',
        gap: 6,
        padding: 6,
        background: 'rgba(24, 24, 27, 0.95)',
        border: '1px solid #3f3f46',
        borderRadius: 8,
        backdropFilter: 'blur(8px)',
        alignItems: 'center',
        minWidth: 280,
      }}
    >
      <Search size={14} color="#71717a" style={{ marginLeft: 4 }} />
      <input
        type="text"
        placeholder="Search indexed content…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={busy}
        aria-label="Search"
        style={{
          flex: 1,
          padding: '4px 8px',
          fontSize: 13,
          background: 'transparent',
          color: '#fafafa',
          border: 'none',
          outline: 'none',
        }}
      />
      <button
        type="submit"
        disabled={busy || !query.trim()}
        style={{
          padding: '4px 10px',
          fontSize: 12,
          background: '#27272a',
          color: '#fafafa',
          border: '1px solid #3f3f46',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        {busy ? 'Searching…' : 'Search'}
      </button>
      {error && (
        <span style={{ fontSize: 11, color: '#ef4444', marginLeft: 8 }}>{error}</span>
      )}
    </form>
  );
}

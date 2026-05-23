import type { ResultKind } from '../../../src/core/source';

export type SearchResult = {
  id: string;
  sourceId: string;
  kind: ResultKind;
  shape: Record<string, unknown>;
  provenance: { uri: string; fetchedAt: number };
  freshness: { ttlMs?: number };
  links: [];
};

export type SearchResponse = {
  results: SearchResult[];
};

export async function search(query: string, limit = 10): Promise<SearchResponse> {
  const res = await fetch('/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Search failed: ${(err as { error?: string }).error ?? res.statusText}`);
  }
  return res.json() as Promise<SearchResponse>;
}

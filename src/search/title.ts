/**
 * Derive a human-readable title from a chunk URI.
 * Reused by SearchService (for agent-tool snippets) and the backend
 * search route (for widget shape props). Single source of truth.
 */
export function titleFromUri(uri: string): string {
  if (!uri) return 'Untitled';
  try {
    const u = new URL(uri);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || u.host || uri;
  } catch {
    return uri.split('/').pop() || uri;
  }
}

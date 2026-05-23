/**
 * Convert browser-side preference counters into a system-prompt hint
 * the agent reads at the start of each turn. Mirrors the scoring used
 * in app/src/state/preferences-store.ts so dev + prod match.
 *
 *   score(kind) = placed + 2*pinned − deleted
 *
 * We split into top-preferred (positive score) and top-avoided
 * (negative score), capped at 5 each. The resulting hint reads as:
 *
 *   The user has shown a preference for: chart (8), table (4), markdown (3).
 *   The user often dismisses: ticket (4 deletions), kanban (2 deletions).
 *   Bias future widget choices accordingly when multiple kinds would
 *   reasonably fit.
 *
 * Returns an empty string when there's no usable signal so callers
 * can safely concatenate without checking.
 */

const TOP_N = 5;

type Counters = { placed: number; deleted: number; pinned: number };

export function buildPreferencesHint(
  prefs:
    | { byKind?: Record<string, Counters> }
    | undefined
    | null,
): string {
  if (!prefs || !prefs.byKind) return '';
  const entries = Object.entries(prefs.byKind);
  if (entries.length === 0) return '';

  const scored = entries.map(([kind, c]) => ({
    kind,
    counters: c,
    score: c.placed + 2 * c.pinned - c.deleted,
  }));

  const preferred = scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

  const avoided = scored
    .filter((x) => x.score < 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, TOP_N);

  if (preferred.length === 0 && avoided.length === 0) return '';

  const lines: string[] = [];
  lines.push(
    'User preferences (signals from prior placements + edits in this conversation — bias future choices toward these):',
  );
  if (preferred.length > 0) {
    const items = preferred
      .map((p) => `${p.kind} (score ${p.score})`)
      .join(', ');
    lines.push(`- Preferred: ${items}`);
  }
  if (avoided.length > 0) {
    const items = avoided
      .map((p) => `${p.kind} (${p.counters.deleted} dismissals)`)
      .join(', ');
    lines.push(`- Often dismissed: ${items}`);
  }
  lines.push(
    "When multiple widget kinds reasonably fit, prefer the user's preferred kinds and avoid the dismissed ones.",
  );
  return lines.join('\n');
}

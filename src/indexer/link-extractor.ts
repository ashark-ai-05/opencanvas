/**
 * Cross-entity link extractor.
 *
 * Scans chunk bodies for cross-references to other artifacts (JIRA
 * tickets, Stash PRs, Confluence pages, absolute file paths) and writes
 * `links` rows so the canvas can render outbound edges even for
 * artifacts that haven't been ingested yet.
 *
 * Spec: REPLICATION-PROMPT.md §9 + KNOWLEDGE-BASE.md.
 *
 * Pattern table:
 *   [A-Z]{2,10}-\d{1,7} (minus denylist)        → jira-issue
 *   .../projects/X/repos/Y/pull-requests/N      → stash-pr
 *   .../spaces/X/pages/N or ?pageId=N           → confluence-page
 *   /foo/bar/baz.ext (absolute path)            → code-file
 */

export type ExtractedLink = {
  toUri: string;
  linkType: 'jira-issue' | 'stash-pr' | 'confluence-page' | 'code-file';
  /** 0..1 confidence — single-pattern matches are 1; ambiguous regex hits 0.5. */
  confidence: number;
};

/**
 * Tokens that look like JIRA keys but never are. Spec §9.
 * Add new ones cautiously — false negatives cost less than false positives.
 */
const JIRA_DENYLIST = new Set<string>([
  'UTF-8',
  'UTF-16',
  'UTF-32',
  'RFC-1',
  'RFC-2',
  'RFC-822',
  'RFC-1034',
  'RFC-2822',
  'ISO-8',
  'ISO-9',
  'ISO-10',
  'ISO-8859',
  'IPV-4',
  'IPV-6',
]);

const JIRA_PATTERN = /\b([A-Z]{2,10}-\d{1,7})\b/g;
const STASH_PR_PATTERN =
  /https?:\/\/[^\s/]+\/(?:projects|scm)\/[A-Za-z0-9-]+\/repos\/[A-Za-z0-9._-]+\/pull-requests\/\d+\b/g;
const CONFLUENCE_PAGE_PATTERN_PATH =
  /https?:\/\/[^\s]+\/spaces\/[A-Za-z0-9-]+\/pages\/\d+\b/g;
const CONFLUENCE_PAGE_PATTERN_QUERY = /https?:\/\/[^\s]+\?pageId=\d+\b/g;
// Absolute filesystem path with an extension (anchor on whitespace
// boundary so we don't drag in surrounding punctuation/words).
const FILE_PATH_PATTERN = /(?:^|\s)(\/[^\s'"`<>{}()]+?\.[A-Za-z0-9]+)\b/g;

export function extractLinks(text: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const seen = new Set<string>();

  const push = (toUri: string, linkType: ExtractedLink['linkType']) => {
    const key = `${linkType}::${toUri}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ toUri, linkType, confidence: 1 });
  };

  // JIRA keys — strip denylist + collapse duplicates.
  for (const m of text.matchAll(JIRA_PATTERN)) {
    const key = m[1]!;
    if (JIRA_DENYLIST.has(key)) continue;
    push(key, 'jira-issue');
  }

  for (const m of text.matchAll(STASH_PR_PATTERN)) {
    push(m[0]!, 'stash-pr');
  }

  for (const m of text.matchAll(CONFLUENCE_PAGE_PATTERN_PATH)) {
    push(m[0]!, 'confluence-page');
  }
  for (const m of text.matchAll(CONFLUENCE_PAGE_PATTERN_QUERY)) {
    push(m[0]!, 'confluence-page');
  }

  for (const m of text.matchAll(FILE_PATH_PATTERN)) {
    push(m[1]!, 'code-file');
  }

  return out;
}

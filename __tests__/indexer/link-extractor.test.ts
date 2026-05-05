import { describe, it, expect } from 'vitest';
import { extractLinks } from '../../src/indexer/link-extractor.js';

describe('link-extractor', () => {
  it('extracts JIRA keys but skips the denylist', () => {
    const text =
      'see ABC-1234 and DFO-99 — but not UTF-8 or RFC-822 in this paragraph';
    const links = extractLinks(text).filter((l) => l.linkType === 'jira-issue');
    expect(links.map((l) => l.toUri).sort()).toEqual(['ABC-1234', 'DFO-99']);
  });

  it('deduplicates repeats of the same JIRA key', () => {
    const text = 'ABC-1 ABC-1 ABC-1';
    const links = extractLinks(text).filter((l) => l.linkType === 'jira-issue');
    expect(links).toHaveLength(1);
  });

  it('extracts Stash PR URLs', () => {
    const text =
      'see https://stash.example.com/projects/ETD/repos/credit-service-parent/pull-requests/8128';
    const links = extractLinks(text).filter((l) => l.linkType === 'stash-pr');
    expect(links).toHaveLength(1);
    expect(links[0]!.toUri).toBe(
      'https://stash.example.com/projects/ETD/repos/credit-service-parent/pull-requests/8128',
    );
  });

  it('extracts Confluence page URLs (path and query forms)', () => {
    const links = extractLinks(
      'old: https://wiki.example.com/spaces/FXETR/pages/123456 ' +
        'new: https://wiki.example.com/wiki/display?pageId=987654',
    ).filter((l) => l.linkType === 'confluence-page');
    expect(links).toHaveLength(2);
  });

  it('extracts absolute file paths with extensions', () => {
    const links = extractLinks('see /home/me/work/foo/bar/baz.ts for context').filter(
      (l) => l.linkType === 'code-file',
    );
    expect(links).toHaveLength(1);
    expect(links[0]!.toUri).toBe('/home/me/work/foo/bar/baz.ts');
  });

  it('returns [] when the text has no recognisable references', () => {
    expect(extractLinks('just plain prose with no links')).toEqual([]);
  });
});

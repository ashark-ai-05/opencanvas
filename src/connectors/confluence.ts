/**
 * Confluence REST connector.
 *
 * Uses the v1 `content` endpoint with CQL filtered by space and
 * lastModified. Cursor is the max page id seen (Confluence ids are
 * monotonically allocated, so the cursor doubles as a since-filter).
 * Cheaper than re-iterating the timestamp index.
 *
 * Auth: CONFLUENCE_PAT env var (Bearer). Throws at construction when missing.
 *
 * Spec: REPLICATION-PROMPT.md §9 + KNOWLEDGE-BASE.md.
 */
import { HttpClient } from './http-client.js';
import {
  requireEnv,
  type Connector,
  type ConnectorRunOpts,
  type ConnectorRunResult,
  type RawDocument,
} from './types.js';

export type ConfluenceConnectorOptions = {
  project: string;
  baseUrl: string;
  spaceKeys: string[];
  pageSize?: number;
};

type ConfluencePage = {
  id: string;
  title: string;
  space?: { key?: string };
  body?: { storage?: { value?: string } };
  version?: { when?: string; number?: number };
  history?: { lastUpdated?: { when?: string } };
  _links?: { webui?: string };
};

type ConfluenceSearchResponse = {
  results: ConfluencePage[];
  size?: number;
  start?: number;
  limit?: number;
  _links?: { next?: string };
};

export class ConfluenceConnector implements Connector {
  readonly id: string;
  private readonly client: HttpClient;
  private readonly baseUrl: string;
  private readonly spaceKeys: string[];
  private readonly pageSize: number;
  private readonly project: string;

  constructor(options: ConfluenceConnectorOptions) {
    if (options.spaceKeys.length === 0) {
      throw new Error('ConfluenceConnector requires at least one spaceKey');
    }
    const token = requireEnv('CONFLUENCE_PAT');
    this.project = options.project;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.spaceKeys = options.spaceKeys;
    this.pageSize = options.pageSize ?? 25;
    this.client = new HttpClient({ baseUrl: this.baseUrl, token });
    this.id = `confluence:${this.spaceKeys.join(',')}`;
  }

  async *run(
    opts: ConnectorRunOpts,
  ): AsyncGenerator<RawDocument, ConnectorRunResult> {
    const cursorTs = opts.since ?? '';
    let maxSeen = cursorTs;

    for (const spaceKey of this.spaceKeys) {
      const sourceId = `confluence:${spaceKey}`;
      let start = 0;
      for (let page = 0; page < 10; page++) {
        const res = await this.client.getJson<ConfluenceSearchResponse>(
          '/rest/api/content/search',
          {
            cql: cursorTs
              ? `space = "${spaceKey}" AND type = page AND lastModified > "${cursorTs}" ORDER BY lastModified DESC`
              : `space = "${spaceKey}" AND type = page ORDER BY lastModified DESC`,
            expand: 'body.storage,version,history.lastUpdated',
            start,
            limit: this.pageSize,
          },
        );

        const results = res.results ?? [];
        if (results.length === 0) break;

        for (const item of results) {
          const updated =
            item.version?.when ?? item.history?.lastUpdated?.when ?? '';
          const html = item.body?.storage?.value ?? '';
          const text = stripHtml(html);

          const url =
            item._links?.webui
              ? `${this.baseUrl}${item._links.webui}`
              : `${this.baseUrl}/spaces/${spaceKey}/pages/${item.id}`;

          yield {
            sourceId,
            kind: 'confluence-page',
            uri: url,
            title: item.title,
            body: text,
            meta: {
              pageId: item.id,
              spaceKey,
              ...(updated ? { updated } : {}),
              version: item.version?.number,
            },
          };

          if (updated && updated > maxSeen) maxSeen = updated;
        }

        if (results.length < this.pageSize) break;
        start += results.length;
      }
    }

    return { cursorAfter: maxSeen || cursorTs };
  }
}

/**
 * Lightweight HTML→text. Confluence storage format is XHTML; we strip
 * tags, decode common entities, and collapse runs of whitespace. Good
 * enough for FTS5 indexing — the orchestrator chunks the result and
 * embeds either the raw chunks or the QA-enricher's 12 queries.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

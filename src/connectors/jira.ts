/**
 * JIRA REST connector.
 *
 * Uses Atlassian's `/rest/api/2/search` JQL endpoint. Pulls issues
 * updated >= cursor (ISO timestamp). Cursor advances on every issue —
 * the JIRA API returns issues in `updated DESC` order so we look for
 * the MAX `updated` we've seen.
 *
 * Auth: JIRA_PAT env var (Bearer). Throws at construction when missing.
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

export type JiraConnectorOptions = {
  project: string;
  baseUrl: string;
  projectKeys: string[];
  /** Tunable batch size — default 50 (JIRA cap is typically 100). */
  pageSize?: number;
};

type JiraIssueRaw = {
  key: string;
  fields: {
    summary?: string;
    description?: string;
    status?: { name?: string };
    assignee?: { displayName?: string; name?: string };
    priority?: { name?: string };
    issuetype?: { name?: string };
    updated?: string;
    created?: string;
    labels?: string[];
  };
};

type JiraSearchResponse = {
  issues: JiraIssueRaw[];
  total?: number;
};

export class JiraConnector implements Connector {
  readonly id: string;
  private readonly client: HttpClient;
  private readonly projectKeys: string[];
  private readonly pageSize: number;
  private readonly baseUrl: string;
  private readonly project: string;

  constructor(options: JiraConnectorOptions) {
    if (options.projectKeys.length === 0) {
      throw new Error('JiraConnector requires at least one projectKey');
    }
    const token = requireEnv('JIRA_PAT');
    this.project = options.project;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.projectKeys = options.projectKeys;
    this.pageSize = options.pageSize ?? 50;
    this.client = new HttpClient({
      baseUrl: this.baseUrl,
      token,
    });
    // Use the first project key in the source id; multi-key configs are
    // rare and primarily for test fixtures. Per spec source-id table: jira:<projectKey>.
    this.id = `jira:${this.projectKeys.join(',')}`;
  }

  async *run(
    opts: ConnectorRunOpts,
  ): AsyncGenerator<RawDocument, ConnectorRunResult> {
    let cursorTs = opts.since ?? '';
    let maxSeen = cursorTs;

    const projectsClause = this.projectKeys.map((k) => `"${k}"`).join(',');
    const updatedClause = cursorTs ? ` AND updated >= "${cursorTs}"` : '';
    const jql = `project in (${projectsClause})${updatedClause} ORDER BY updated DESC`;

    let startAt = 0;
    // Hard cap: 10 pages × pageSize = 500 issues per run. Prevents a
    // misconfigured project from running unbounded.
    for (let page = 0; page < 10; page++) {
      const body = await this.client.postJson<JiraSearchResponse>(
        '/rest/api/2/search',
        {
          jql,
          startAt,
          maxResults: this.pageSize,
          fields: [
            'summary',
            'description',
            'status',
            'assignee',
            'priority',
            'issuetype',
            'updated',
            'created',
            'labels',
          ],
        },
      );

      const issues = body.issues ?? [];
      if (issues.length === 0) break;

      for (const issue of issues) {
        const f = issue.fields ?? {};
        const title = f.summary ?? issue.key;
        const status = f.status?.name ?? 'Unknown';
        const assignee = f.assignee?.displayName ?? f.assignee?.name;
        const priority = f.priority?.name;
        const issuetype = f.issuetype?.name;
        const updated = f.updated ?? '';
        const description = f.description ?? '';

        const body = [
          `${issue.key} — ${title}`,
          `Status: ${status}`,
          assignee ? `Assignee: ${assignee}` : null,
          priority ? `Priority: ${priority}` : null,
          issuetype ? `Type: ${issuetype}` : null,
          updated ? `Updated: ${updated}` : null,
          '',
          description,
        ]
          .filter((s): s is string => s !== null)
          .join('\n');

        yield {
          sourceId: `jira:${this.projectKeys[0]}`,
          kind: 'jira-issue',
          uri: `${this.baseUrl}/browse/${issue.key}`,
          title: `${issue.key} — ${title}`,
          body,
          meta: {
            ticketId: issue.key,
            status,
            ...(assignee ? { assignee } : {}),
            ...(priority ? { priority } : {}),
            ...(issuetype ? { issuetype } : {}),
            ...(updated ? { updated } : {}),
            labels: f.labels ?? [],
          },
        };

        if (updated && updated > maxSeen) maxSeen = updated;
      }

      startAt += issues.length;
      if (issues.length < this.pageSize) break;
    }

    return { cursorAfter: maxSeen || cursorTs };
  }
}

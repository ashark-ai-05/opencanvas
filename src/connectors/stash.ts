/**
 * Bitbucket / Stash REST connector.
 *
 * Pulls pull-requests for each (projectKey, repoSlug) pair under
 * `/rest/api/1.0/projects/{projectKey}/repos/{repoSlug}/pull-requests`.
 * Cursor is the max `updatedDate` across PRs (epoch ms as a string).
 *
 * Auth: STASH_PAT env var (Bearer). Throws at construction when missing.
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

export type StashRepo = {
  projectKey: string;
  repoSlug: string;
};

export type StashConnectorOptions = {
  project: string;
  baseUrl: string;
  repos: StashRepo[];
  pageSize?: number;
};

type StashPullRequest = {
  id: number;
  title: string;
  description?: string;
  state: string;
  author?: { user?: { name?: string; displayName?: string } };
  reviewers?: Array<{ user?: { displayName?: string } }>;
  fromRef?: { displayId?: string };
  toRef?: { displayId?: string };
  createdDate?: number;
  updatedDate?: number;
  links?: { self?: Array<{ href?: string }> };
};

type StashPagedResponse = {
  values: StashPullRequest[];
  isLastPage: boolean;
  nextPageStart?: number;
};

export class StashConnector implements Connector {
  readonly id: string;
  private readonly client: HttpClient;
  private readonly repos: StashRepo[];
  private readonly pageSize: number;
  private readonly baseUrl: string;
  private readonly project: string;

  constructor(options: StashConnectorOptions) {
    if (options.repos.length === 0) {
      throw new Error('StashConnector requires at least one repo');
    }
    const token = requireEnv('STASH_PAT');
    this.project = options.project;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.repos = options.repos;
    this.pageSize = options.pageSize ?? 50;
    this.client = new HttpClient({ baseUrl: this.baseUrl, token });
    const firstRepo = this.repos[0]!;
    this.id = `stash:${firstRepo.projectKey}/${firstRepo.repoSlug}`;
  }

  async *run(
    opts: ConnectorRunOpts,
  ): AsyncGenerator<RawDocument, ConnectorRunResult> {
    const cursorTs = opts.since ? Number(opts.since) : 0;
    let maxSeen = cursorTs;

    for (const repo of this.repos) {
      const sourceId = `stash:${repo.projectKey}/${repo.repoSlug}`;
      let start: number | undefined = 0;
      // Hard cap: 10 pages per repo per run.
      for (let page = 0; page < 10; page++) {
        const res: StashPagedResponse = await this.client.getJson<StashPagedResponse>(
          `/rest/api/1.0/projects/${repo.projectKey}/repos/${repo.repoSlug}/pull-requests`,
          {
            state: 'ALL',
            order: 'NEWEST',
            limit: this.pageSize,
            start,
          },
        );

        for (const pr of res.values ?? []) {
          if (pr.updatedDate && pr.updatedDate <= cursorTs) {
            // PRs are NEWEST first — anything from here on is older.
            return { cursorAfter: String(maxSeen) };
          }
          const author = pr.author?.user?.displayName ?? pr.author?.user?.name;
          const linkHref =
            pr.links?.self?.[0]?.href ??
            `${this.baseUrl}/projects/${repo.projectKey}/repos/${repo.repoSlug}/pull-requests/${pr.id}`;

          const body = [
            `PR #${pr.id} — ${pr.title}`,
            `State: ${pr.state}`,
            author ? `Author: ${author}` : null,
            pr.fromRef?.displayId ? `From: ${pr.fromRef.displayId}` : null,
            pr.toRef?.displayId ? `To: ${pr.toRef.displayId}` : null,
            pr.updatedDate
              ? `Updated: ${new Date(pr.updatedDate).toISOString()}`
              : null,
            '',
            pr.description ?? '',
          ]
            .filter((s): s is string => s !== null)
            .join('\n');

          yield {
            sourceId,
            kind: 'stash-pr',
            uri: linkHref,
            title: `${repo.projectKey}/${repo.repoSlug}#${pr.id}: ${pr.title}`,
            body,
            meta: {
              prId: pr.id,
              state: pr.state,
              ...(author ? { author } : {}),
              ...(pr.updatedDate ? { updatedDate: pr.updatedDate } : {}),
              repo: `${repo.projectKey}/${repo.repoSlug}`,
            },
          };

          if (pr.updatedDate && pr.updatedDate > maxSeen) maxSeen = pr.updatedDate;
        }

        if (res.isLastPage) break;
        start = res.nextPageStart;
        if (start === undefined) break;
      }
    }

    return { cursorAfter: String(maxSeen || cursorTs) };
  }
}

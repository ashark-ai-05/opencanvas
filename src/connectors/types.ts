/**
 * Shared connector contract.
 *
 * Every KB connector — code, jira, stash, confluence, future ones —
 * implements `Connector` and yields `RawDocument`s. The orchestrator
 * chunks, enriches, and persists each document; the connector only has
 * to fetch + paginate + filter by cursor.
 *
 * Spec: REPLICATION-PROMPT.md §9 + KNOWLEDGE-BASE.md.
 */

export type RawDocument = {
  /**
   * Stable connector source id. Convention:
   *   - code:        `code:<project>`
   *   - stash:       `stash:<projectKey>/<repoSlug>`
   *   - jira:        `jira:<projectKey>`
   *   - confluence:  `confluence:<spaceKey>`
   */
  sourceId: string;
  kind: string; // 'doc-file' | 'jira-issue' | 'stash-pr' | 'confluence-page' | 'code-file'
  uri: string;
  title: string;
  body: string;
  /**
   * Connector-specific metadata. The orchestrator stamps `meta.project`
   * with the configured project name before persisting, so search can
   * filter via SearchService project scope.
   */
  meta: Record<string, unknown>;
};

export type ConnectorRunOpts = {
  /**
   * Cursor from a prior run — connector-specific (sha for code, ISO ts
   * for jira, page id for confluence). Connector skips anything ≤ this.
   */
  since?: string;
};

export type ConnectorRunResult = {
  /**
   * New cursor to persist after this run completes. Should monotonically
   * advance — re-running with the returned cursor must yield zero new
   * documents (idempotency contract, spec §19).
   */
  cursorAfter?: string;
};

/**
 * The contract every connector implements. `id` is the same convention
 * as `RawDocument.sourceId` (see above).
 */
export interface Connector {
  readonly id: string;
  run(opts: ConnectorRunOpts): AsyncGenerator<RawDocument, ConnectorRunResult>;
}

/**
 * Read a required env var or throw a descriptive error at construction
 * time. Connectors call this in their constructor — fail-fast lets the
 * orchestrator skip a missing-secrets connector cleanly instead of
 * yielding errors mid-iteration.
 */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(
      `Required env var ${name} is not set. Add it to your .env file.`,
    );
  }
  return v;
}

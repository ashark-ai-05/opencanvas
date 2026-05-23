/**
 * `pnpm cli --kb-*` command implementations.
 *
 * Surface (spec §15):
 *   --kb-init <name>    [--kb-root <path>] [--no-enrich]
 *   --kb-ingest <name>  [--kb-only code|jira|stash|confluence] [--kb-enrich-limit N] [--kb-enrich-kinds k1,k2,…]
 *   --kb-status <name>
 *   --kb-search <name>  "<query>"
 *   --kb-export <name>  --kb-out <dir>
 */
import { resolve } from 'node:path';
import {
  loadConfig,
  saveConfig,
  loadKbProjects,
  findKbProject,
} from '../config/loader.js';
import type { KbProject } from '../config/schema.js';
import { openDefaultStore, type Store } from '../storage/store.js';
import { createEmbedder } from '../embedders/index.js';
import { createProvider } from '../providers/index.js';
import { SearchService } from '../search/service.js';
import { KnowledgeBaseOrchestrator } from '../indexer/orchestrator.js';
import { QaEnricher } from '../indexer/qa-enricher.js';
import { CodeConnector } from '../connectors/code.js';
import { JiraConnector } from '../connectors/jira.js';
import { StashConnector } from '../connectors/stash.js';
import { ConfluenceConnector } from '../connectors/confluence.js';
import type { Connector } from '../connectors/types.js';
import { exportProject } from './export.js';

export type KbInitOpts = {
  name: string;
  rootPath?: string;
  enrich: boolean;
};

export async function kbInit(opts: KbInitOpts): Promise<void> {
  const next = saveConfig((cfg) => {
    const existing = cfg.knowledgeBase.projects.find((p) => p.name === opts.name);
    const project: KbProject = existing
      ? { ...existing, enrich: opts.enrich }
      : {
          name: opts.name,
          enrich: opts.enrich,
          ...(opts.rootPath ? { code: { rootPath: resolve(opts.rootPath) } } : {}),
        };
    if (opts.rootPath) {
      project.code = { rootPath: resolve(opts.rootPath) };
    }
    const others = cfg.knowledgeBase.projects.filter((p) => p.name !== opts.name);
    return {
      ...cfg,
      knowledgeBase: {
        projects: [...others, project],
      },
    };
  });
  const wrote = next.knowledgeBase.projects.find((p) => p.name === opts.name);
  console.log(`[kb-init] saved project "${opts.name}":`, wrote);
}

export type KbIngestOpts = {
  name: string;
  /** When set, only run this connector kind. */
  only?: 'code' | 'jira' | 'stash' | 'confluence';
  /** Cap LLM calls per run; 0 = unlimited. */
  enrichLimit?: number;
  /** Whitelist of doc kinds to enrich; empty = all. */
  enrichKinds?: string[];
  /** Override the active profile. */
  profile?: string;
};

export async function kbIngest(opts: KbIngestOpts): Promise<void> {
  const project = requireProject(opts.name);
  const { activeProfile } = loadConfig(opts.profile);
  const store = await openDefaultStore();
  try {
    const embedder = createEmbedder(activeProfile);
    const enricher = project.enrich
      ? new QaEnricher({
          provider: createProvider(activeProfile, {}),
          modelLabel: activeProfile.llm.provider,
        })
      : undefined;

    const connectors = buildConnectors(project, opts.only);
    if (connectors.length === 0) {
      console.error(`[kb-ingest] project "${project.name}" has no enabled connectors${opts.only ? ` matching --kb-only ${opts.only}` : ''}`);
      return;
    }

    const orchestrator = new KnowledgeBaseOrchestrator({
      store,
      embedder,
      ...(enricher ? { enricher } : {}),
      project: project.name,
      ...(opts.enrichLimit !== undefined ? { enrichLimit: opts.enrichLimit } : {}),
      ...(opts.enrichKinds && opts.enrichKinds.length > 0
        ? { enrichKinds: new Set(opts.enrichKinds) }
        : {}),
    });

    console.log(
      `Ingesting '${project.name}' (${connectors.map((c) => labelOf(c)).join(', ')})…`,
    );
    for (const connector of connectors) {
      const since = readLastCursor(store, project.name, connector.id);
      const summary = await orchestrator.run(connector, since);
      console.log(
        `[${labelOf(connector).padEnd(11)}] docs=${summary.docs} chunks=${summary.chunks} cacheHits=${summary.cacheHits} llmCalls=${summary.llmCalls} links=${summary.links} cursor=${summary.cursor ?? ''}`,
      );
    }
  } finally {
    store.close();
  }
}

export async function kbStatus(name: string): Promise<void> {
  const project = requireProject(name);
  const store = await openDefaultStore();
  try {
    const states = store.db
      .prepare(
        `SELECT source_id, cursor, last_run_at, doc_count
         FROM source_state WHERE project = ? ORDER BY source_id`,
      )
      .all(project.name) as Array<{
      source_id: string;
      cursor: string | null;
      last_run_at: number;
      doc_count: number;
    }>;

    if (states.length === 0) {
      console.log(`[kb-status] no runs recorded for "${name}"`);
      return;
    }

    console.log(`Project '${name}'`);
    for (const s of states) {
      const lastRun = new Date(s.last_run_at).toISOString();
      console.log(
        `  ${s.source_id}: cursor=${s.cursor ?? ''} last_run_at=${lastRun} doc_count=${s.doc_count}`,
      );
    }

    const chunkCounts = store.db
      .prepare(
        `SELECT kind, COUNT(*) AS c
         FROM chunks WHERE json_extract(meta_json, '$.project') = ? GROUP BY kind`,
      )
      .all(project.name) as Array<{ kind: string; c: number }>;

    console.log('Chunks by kind:');
    for (const row of chunkCounts) console.log(`  ${row.kind}: ${row.c}`);

    const linkCounts = store.db
      .prepare(
        `SELECT link_type, COUNT(*) AS c
         FROM links
         JOIN chunks ON chunks.id = links.from_chunk_id
         WHERE json_extract(chunks.meta_json, '$.project') = ?
         GROUP BY link_type`,
      )
      .all(project.name) as Array<{ link_type: string; c: number }>;

    if (linkCounts.length > 0) {
      console.log('Links by type:');
      for (const row of linkCounts)
        console.log(`  ${row.link_type}: ${row.c}`);
    }

    const qaCount = store.db
      .prepare(
        `SELECT COUNT(*) AS c FROM qa_pairs
         JOIN chunks ON chunks.id = qa_pairs.chunk_id
         WHERE json_extract(chunks.meta_json, '$.project') = ?`,
      )
      .get(project.name) as { c: number };
    console.log(`qa_pairs: ${qaCount.c}`);
  } finally {
    store.close();
  }
}

export async function kbSearch(name: string, query: string): Promise<void> {
  const project = requireProject(name);
  const { activeProfile } = loadConfig();
  const store = await openDefaultStore();
  try {
    const embedder = createEmbedder(activeProfile);
    const svc = new SearchService({ store, embedder });
    const results = await svc.search(query, 10, { project: project.name });
    console.log(`Top ${results.length} hits for "${query}" in project '${name}':`);
    for (const r of results) {
      console.log(`  [${r.score.toFixed(4)}] ${r.kind} :: ${r.title}`);
      console.log(`     ${r.snippet}`);
    }
  } finally {
    store.close();
  }
}

export async function kbExport(name: string, outDir: string): Promise<void> {
  const project = requireProject(name);
  const store = await openDefaultStore();
  try {
    const written = await exportProject(store, project.name, outDir);
    console.log(`[kb-export] wrote ${written.length} files to ${outDir}`);
    for (const w of written) console.log(`  ${w}`);
  } finally {
    store.close();
  }
}

function requireProject(name: string): KbProject {
  const found = findKbProject(name);
  if (!found) {
    const all = loadKbProjects()
      .map((p) => p.name)
      .join(', ');
    throw new Error(
      `kb project "${name}" not found. Configured: ${all || '(none)'}`,
    );
  }
  return found;
}

function readLastCursor(
  store: Store,
  project: string,
  sourceId: string,
): string | undefined {
  const row = store.db
    .prepare(
      `SELECT cursor FROM source_state WHERE project = ? AND source_id = ?`,
    )
    .get(project, sourceId) as { cursor: string | null } | undefined;
  return row?.cursor ?? undefined;
}

function labelOf(connector: Connector): string {
  return connector.id.split(':')[0] ?? connector.id;
}

function buildConnectors(
  project: KbProject,
  only?: KbIngestOpts['only'],
): Connector[] {
  const out: Connector[] = [];
  if ((!only || only === 'code') && project.code) {
    out.push(
      new CodeConnector({ project: project.name, rootPath: project.code.rootPath }),
    );
  }
  if ((!only || only === 'jira') && project.jira) {
    out.push(
      new JiraConnector({
        project: project.name,
        baseUrl: project.jira.baseUrl,
        projectKeys: project.jira.projectKeys,
      }),
    );
  }
  if ((!only || only === 'stash') && project.stash) {
    out.push(
      new StashConnector({
        project: project.name,
        baseUrl: project.stash.baseUrl,
        repos: project.stash.repos,
      }),
    );
  }
  if ((!only || only === 'confluence') && project.confluence) {
    out.push(
      new ConfluenceConnector({
        project: project.name,
        baseUrl: project.confluence.baseUrl,
        spaceKeys: project.confluence.spaceKeys,
      }),
    );
  }
  return out;
}

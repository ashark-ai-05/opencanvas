/**
 * strata CLI entry point.
 *
 * Usage:
 *   pnpm cli --profile <name> "<prompt>"   # stream a response
 *   pnpm cli --probe                        # health-check the active provider and embedder
 *   pnpm cli --list-profiles               # list configured profiles
 *   pnpm cli --embed "<text>"              # embed text and print dims + first 8 values
 *   pnpm cli --storage-status             # show store path, size, and table row counts
 *
 * The --profile flag overrides the activeProfile from config.
 * Usage stats are printed to stderr at the end (doesn't pollute stdout output).
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './config/loader.js';
import { createProvider } from './providers/index.js';
import { createEmbedder } from './embedders/index.js';
import type { ProviderEvent } from './core/provider.js';

function printUsage(): void {
  console.error(`
Usage:
  pnpm cli [--profile <name>] "<prompt>"    Stream a response
  pnpm cli [--profile <name>] --probe       Health-check the active provider and embedder
  pnpm cli --list-profiles                  List all configured profiles
  pnpm cli [--profile <name>] --embed "<text>"       Embed text and print vector info
  pnpm cli --storage-status                 Show store path, size, and table row counts

Examples:
  pnpm cli "What is 2+2?"
  pnpm cli --profile claude-sdk "Explain async generators in TypeScript"
  pnpm cli --probe
  pnpm cli --list-profiles
  pnpm cli --embed "the quick brown fox"
  pnpm cli --storage-status
`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      profile: { type: 'string', short: 'p' },
      probe: { type: 'boolean' },
      'list-profiles': { type: 'boolean' },
      embed: { type: 'string' },
      'storage-status': { type: 'boolean' },
      'list-sources': { type: 'boolean' },
      'probe-sources': { type: 'boolean' },
      'list-tools': { type: 'string' },
      'call-tool': { type: 'string' },
      index: { type: 'string' },
      search: { type: 'string' },
      'index-code': { type: 'string' },
      'index-url': { type: 'string' },
      'search-symbols': { type: 'string' },
      'source-id': { type: 'string' },
      // Knowledge-base (per-project) flags
      'kb-init': { type: 'string' },
      'kb-root': { type: 'string' },
      'no-enrich': { type: 'boolean' },
      'kb-ingest': { type: 'string' },
      'kb-only': { type: 'string' },
      'kb-enrich-limit': { type: 'string' },
      'kb-enrich-kinds': { type: 'string' },
      'kb-status': { type: 'string' },
      'kb-search': { type: 'string' },
      'kb-export': { type: 'string' },
      'kb-out': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  const profileOverride = values.profile as string | undefined;

  // --list-sources: print configured sources from active profile
  if (values['list-sources']) {
    const { activeProfile } = loadConfig(profileOverride);
    if (activeProfile.sources.length === 0) {
      console.log('No sources configured for profile:', activeProfile.name);
      console.log("Add sources to ~/.strata/config.json under profiles[].sources.");
      return;
    }
    console.log(`Sources for profile '${activeProfile.name}':`);
    for (const s of activeProfile.sources) {
      const detail =
        s.transport === 'stdio'
          ? `${s.command} ${s.args.join(' ')}`
          : s.url;
      console.log(`  - ${s.id.padEnd(20)} (${s.transport})  ${s.name}  ${detail}`);
    }
    return;
  }

  // --probe-sources: connect every source, print health + tool count
  if (values['probe-sources']) {
    const { activeProfile } = loadConfig(profileOverride);
    const { SourceRegistry } = await import('./mcp/registry.js');
    const registry = new SourceRegistry();
    const { ok, failed } = await registry.connectAll(activeProfile.sources);

    for (const s of ok) {
      console.log(`[OK]   ${s.id.padEnd(20)} ${s.name}  tools=${s.tools.length}`);
    }
    for (const f of failed) {
      console.log(`[FAIL] ${f.config.id.padEnd(20)} ${f.config.name}  ${f.error}`);
    }

    await registry.closeAll();
    return;
  }

  // --list-tools <source-id>: connect one source, print its tool catalog
  if (values['list-tools']) {
    const sourceId = values['list-tools'] as string;
    const { activeProfile } = loadConfig(profileOverride);
    const config = activeProfile.sources.find((s) => s.id === sourceId);
    if (!config) {
      console.error(`No source with id '${sourceId}' in profile '${activeProfile.name}'.`);
      process.exit(1);
    }
    const { createMcpClient } = await import('./mcp/transport.js');
    const { MCPSource } = await import('./mcp/source.js');
    const client = await createMcpClient(config);
    const source = new MCPSource(config.id, config.name, client);
    await source.introspect();
    console.log(`Tools for ${source.name} (${source.tools.length}):`);
    for (const t of source.tools) {
      console.log(`  - ${t.name.padEnd(28)} ${t.description ?? ''}`);
    }
    await source.close();
    return;
  }

  // --call-tool <source-id> <tool-name> [json-args]: call a single tool
  if (values['call-tool']) {
    const sourceId = values['call-tool'] as string;
    const toolName = positionals[0];
    const argsJson = positionals[1] ?? '{}';
    if (!toolName) {
      console.error('Usage: pnpm cli --call-tool <source-id> <tool-name> [json-args]');
      process.exit(1);
    }
    let toolArgs: unknown;
    try {
      toolArgs = JSON.parse(argsJson);
    } catch (e) {
      console.error('Invalid JSON args:', e instanceof Error ? e.message : String(e));
      process.exit(1);
    }

    const { activeProfile } = loadConfig(profileOverride);
    const config = activeProfile.sources.find((s) => s.id === sourceId);
    if (!config) {
      console.error(`No source with id '${sourceId}' in profile '${activeProfile.name}'.`);
      process.exit(1);
    }
    const { createMcpClient } = await import('./mcp/transport.js');
    const { MCPSource } = await import('./mcp/source.js');
    const client = await createMcpClient(config);
    const source = new MCPSource(config.id, config.name, client);
    try {
      const result = await source.callTool(toolName, toolArgs);
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await source.close();
    }
    return;
  }

  // --index <path>: index a directory of markdown/text files
  if (values['index']) {
    const path = values['index'] as string;
    if (!path) {
      console.error('Usage: pnpm cli --index <path>');
      process.exit(1);
    }

    const config = loadConfig(profileOverride);
    const { openDefaultStore } = await import('./storage/store.js');
    const { DocumentIndexer } = await import('./indexer/document-indexer.js');

    const store = await openDefaultStore();
    const embedder = createEmbedder(config.activeProfile);
    const indexer = new DocumentIndexer({ store, embedder });

    const sourceId = `local:${path}`;
    console.log(`Indexing ${path} (source: ${sourceId})…`);
    const t0 = performance.now();
    const result = await indexer.run({ rootPath: path, sourceId });
    const ms = Math.round(performance.now() - t0);

    console.log(`indexed:  ${result.indexedFiles} files`);
    console.log(`chunks:   ${result.chunks}`);
    console.log(`time:     ${ms} ms`);
    if (result.errors.length > 0) {
      console.log(`errors:   ${result.errors.length}`);
      for (const err of result.errors.slice(0, 5)) {
        console.log(`  - ${err.path}: ${err.error}`);
      }
    }
    store.close();
    return;
  }

  // --search "<query>": hybrid BM25 + vector search
  if (values['search']) {
    const query = values['search'] as string;
    if (!query) {
      console.error('Usage: pnpm cli --search "<query>"');
      process.exit(1);
    }

    const config = loadConfig(profileOverride);
    const { openDefaultStore } = await import('./storage/store.js');
    const { SearchService } = await import('./search/service.js');

    const store = await openDefaultStore();
    const embedder = createEmbedder(config.activeProfile);
    const service = new SearchService({ store, embedder });

    const t0 = performance.now();
    const results = await service.search(query, 10);
    const ms = Math.round(performance.now() - t0);

    console.log(`query:    ${query}`);
    console.log(`results:  ${results.length} (${ms} ms)`);
    console.log('');
    for (const r of results) {
      console.log(`[score ${r.score.toFixed(4)}] (${r.kind}) ${r.title}  [id=${r.id} src=${r.source}]`);
      console.log(`  ${r.snippet.replace(/\n/g, ' ')}`);
      console.log('');
    }
    store.close();
    return;
  }

  // --index-code <path>: walk .ts/.tsx/.js/.jsx files and index symbols + chunks
  if (values['index-code']) {
    const path = values['index-code'] as string;
    if (!path) {
      console.error('Usage: pnpm cli --index-code <path>');
      process.exit(1);
    }

    const { activeProfile } = loadConfig(profileOverride);
    const { openDefaultStore } = await import('./storage/store.js');
    const { CodeIndexer } = await import('./indexer/code/code-indexer.js');

    const store = await openDefaultStore();
    const embedder = createEmbedder(activeProfile);
    const indexer = new CodeIndexer({ store, embedder });

    const sourceId = `local-code:${path}`;
    console.log(`Indexing code at ${path} (source: ${sourceId})…`);
    const t0 = performance.now();
    const result = await indexer.run({ rootPath: path, sourceId });
    const ms = Math.round(performance.now() - t0);

    console.log(`indexed:  ${result.indexedFiles} files`);
    console.log(`symbols:  ${result.symbols}`);
    console.log(`chunks:   ${result.chunks}`);
    console.log(`time:     ${ms} ms`);
    if (result.errors.length > 0) {
      console.log(`errors:   ${result.errors.length}`);
      for (const err of result.errors.slice(0, 5)) {
        console.log(`  - ${err.path}: ${err.error}`);
      }
    }
    store.close();
    return;
  }

  // --search-symbols <name>: search symbols table by name substring
  if (values['search-symbols']) {
    const name = values['search-symbols'] as string;
    if (!name) {
      console.error('Usage: pnpm cli --search-symbols <name-substring>');
      process.exit(1);
    }

    const { openDefaultStore } = await import('./storage/store.js');
    const store = await openDefaultStore();

    const rows = store.db
      .prepare(
        `SELECT name, kind, lang, file, source_id
         FROM symbols
         WHERE name LIKE ?
         ORDER BY name
         LIMIT 50`
      )
      .all(`%${name}%`) as {
        name: string;
        kind: string;
        lang: string;
        file: string;
        source_id: string;
      }[];

    console.log(`symbols matching "${name}": ${rows.length}`);
    for (const row of rows) {
      console.log(`  ${row.kind.padEnd(11)} ${row.name.padEnd(28)} ${row.file}`);
    }
    store.close();
    return;
  }

  // --storage-status: open the DB, run migrations, show table stats
  if (values['storage-status']) {
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const { mkdirSync, existsSync, statSync } = await import('node:fs');
    const { openStore, loadInitialMigrations } = await import('./storage/store.js');
    const { migrate } = await import('./storage/migrations.js');

    const dir = join(homedir(), '.strata');
    const path = join(dir, 'index.sqlite');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const store = await openStore({ path });
    await migrate(store, await loadInitialMigrations());

    const size = existsSync(path) ? statSync(path).size : 0;
    const tables = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    console.log(`store:    ${path}`);
    console.log(`size:     ${(size / 1024).toFixed(1)} KB`);
    console.log('tables:');
    for (const { name } of tables) {
      const row = store.db.prepare(`SELECT count(*) as c FROM "${name}"`).get() as { c: number };
      console.log(`  - ${name.padEnd(20)} rows=${row.c}`);
    }
    store.close();
    return;
  }

  // --embed: embed text and print vector info
  if (values.embed !== undefined) {
    const text = typeof values.embed === 'string' && values.embed.trim() ? values.embed : '';
    if (!text) {
      console.error('Usage: pnpm cli --embed "<text>"');
      process.exit(1);
    }
    let config;
    try {
      config = loadConfig(values.profile as string | undefined);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    const embedder = createEmbedder(config.activeProfile);
    const t0 = performance.now();
    const [vec] = await embedder.embed([text]);
    const ms = Math.round(performance.now() - t0);
    console.log(`embedder: ${embedder.id}`);
    console.log(`dims:     ${vec.length}`);
    console.log(`latency:  ${ms} ms`);
    const head = Array.from(vec.slice(0, 8))
      .map((n) => n.toFixed(4))
      .join(', ');
    console.log(`first 8:  [${head}, ...]`);
    return;
  }

  // KB commands — handled before profile/provider construction since
  // some of them mutate config (kb-init).
  if (typeof values['kb-init'] === 'string') {
    const { kbInit } = await import('./kb/cli-commands.js');
    const opts: Parameters<typeof kbInit>[0] = {
      name: values['kb-init'] as string,
      enrich: !values['no-enrich'],
    };
    if (values['kb-root']) opts.rootPath = values['kb-root'] as string;
    await kbInit(opts);
    return;
  }
  if (typeof values['kb-ingest'] === 'string') {
    const { kbIngest } = await import('./kb/cli-commands.js');
    const opts: Parameters<typeof kbIngest>[0] = {
      name: values['kb-ingest'] as string,
    };
    const only = values['kb-only'];
    if (typeof only === 'string') {
      if (
        only !== 'code' &&
        only !== 'jira' &&
        only !== 'stash' &&
        only !== 'confluence'
      ) {
        console.error(
          `Error: --kb-only must be one of code|jira|stash|confluence`,
        );
        process.exit(1);
      }
      opts.only = only;
    }
    if (typeof values['kb-enrich-limit'] === 'string') {
      const n = Number(values['kb-enrich-limit']);
      if (!Number.isFinite(n) || n < 0) {
        console.error('Error: --kb-enrich-limit must be a non-negative number');
        process.exit(1);
      }
      opts.enrichLimit = n;
    }
    if (typeof values['kb-enrich-kinds'] === 'string') {
      opts.enrichKinds = (values['kb-enrich-kinds'] as string)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    if (typeof values.profile === 'string') opts.profile = values.profile;
    await kbIngest(opts);
    return;
  }
  if (typeof values['kb-status'] === 'string') {
    const { kbStatus } = await import('./kb/cli-commands.js');
    await kbStatus(values['kb-status'] as string);
    return;
  }
  if (typeof values['kb-search'] === 'string') {
    const { kbSearch } = await import('./kb/cli-commands.js');
    const query = positionals.join(' ').trim();
    if (!query) {
      console.error('Error: --kb-search requires a query');
      process.exit(1);
    }
    await kbSearch(values['kb-search'] as string, query);
    return;
  }
  if (typeof values['kb-export'] === 'string') {
    const { kbExport } = await import('./kb/cli-commands.js');
    const out = values['kb-out'];
    if (typeof out !== 'string' || out.length === 0) {
      console.error('Error: --kb-export requires --kb-out <dir>');
      process.exit(1);
    }
    await kbExport(values['kb-export'] as string, out);
    return;
  }

  // Load config — may write a default if missing
  let config;
  try {
    config = loadConfig(values.profile as string | undefined);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // --list-profiles
  if (values['list-profiles']) {
    console.log('Configured profiles:');
    for (const profile of config.allProfiles) {
      const marker = profile.name === config.activeProfile.name ? ' *' : '  ';
      console.log(`${marker} ${profile.name} (${profile.llm.provider})`);
    }
    console.log(`\nConfig: ${config.configPath}`);
    return;
  }

  // --probe: show LLM and embed status
  if (values.probe) {
    const { probeProfile } = await import('./config/probe.js');
    const result = await probeProfile(config.activeProfile);
    const fmt = (label: string, r: { ok: boolean; latencyMs?: number; error?: string; dims?: number }) =>
      r.ok
        ? `[OK]   ${label} — ${r.latencyMs ?? '?'}ms${r.dims ? ` (${r.dims}-d)` : ''}`
        : `[FAIL] ${label} — ${r.error ?? 'unknown'}`;
    console.log(fmt('LLM   ', result.llm));
    console.log(fmt('Embed ', result.embed));
    return;
  }

  const provider = createProvider(config.activeProfile);

  // Prompt query
  const prompt = positionals.join(' ').trim();
  if (!prompt) {
    console.error('Error: no prompt provided.');
    printUsage();
    process.exit(1);
  }

  let usage: { inputTokens?: number; outputTokens?: number } | undefined;
  let hasError = false;

  try {
    for await (const event of provider.query({ prompt })) {
      if (event.type === 'text-delta') {
        process.stdout.write(event.text);
      } else if (event.type === 'reasoning-delta') {
        // Print reasoning to stderr with a prefix so it's visible but separate
        process.stderr.write(`[reasoning] ${event.text}`);
      } else if (event.type === 'tool-input') {
        process.stderr.write(`\n[tool-input: ${event.name}]\n`);
      } else if (event.type === 'tool-result') {
        process.stderr.write(`[tool-result: ${event.name}]\n`);
      } else if (event.type === 'session-started') {
        process.stderr.write(`[session-started: ${event.sessionId}]\n`);
      } else if (event.type === 'error') {
        console.error(`\nError: ${event.message}`);
        hasError = true;
      } else if (event.type === 'done') {
        usage = (event as ProviderEvent & { type: 'done' }).usage;
      }
    }
  } catch (err) {
    console.error(`\nFatal error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Ensure output ends with a newline
  process.stdout.write('\n');

  // Print usage stats to stderr
  if (usage) {
    const parts: string[] = [];
    if (usage.inputTokens !== undefined) parts.push(`in=${usage.inputTokens}`);
    if (usage.outputTokens !== undefined) parts.push(`out=${usage.outputTokens}`);
    if (parts.length > 0) {
      console.error(`[${provider.name}] tokens: ${parts.join(', ')}`);
    }
  }

  if (hasError) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

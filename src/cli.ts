/**
 * llm-wiki CLI entry point.
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
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
  }

  // --storage-status: open the DB, run migrations, show table stats
  if (values['storage-status']) {
    const { homedir } = await import('node:os');
    const { join } = await import('node:path');
    const { mkdirSync, existsSync, statSync } = await import('node:fs');
    const { openStore, loadInitialMigrations } = await import('./storage/store.js');
    const { migrate } = await import('./storage/migrations.js');

    const dir = join(homedir(), '.llm-wiki');
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
      } else if (event.type === 'thinking-delta') {
        // Print thinking to stderr with a prefix so it's visible but separate
        process.stderr.write(`[thinking] ${event.text}`);
      } else if (event.type === 'tool-call') {
        process.stderr.write(`\n[tool-call: ${event.name}]\n`);
      } else if (event.type === 'tool-result') {
        process.stderr.write(`[tool-result: ${event.name}]\n`);
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

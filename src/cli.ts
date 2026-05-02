/**
 * llm-wiki CLI entry point.
 *
 * Usage:
 *   pnpm cli --profile <name> "<prompt>"   # stream a response
 *   pnpm cli --probe                        # health-check the active provider
 *   pnpm cli --list-profiles               # list configured profiles
 *
 * The --profile flag overrides the activeProfile from config.
 * Usage stats are printed to stderr at the end (doesn't pollute stdout output).
 */
import { parseArgs } from 'node:util';
import { loadConfig } from './config/loader.js';
import { createProvider } from './providers/index.js';
import { runProbe } from './config/probe.js';
import type { ProviderEvent } from './core/provider.js';

function printUsage(): void {
  console.error(`
Usage:
  pnpm cli [--profile <name>] "<prompt>"    Stream a response
  pnpm cli [--profile <name>] --probe       Health-check the active provider
  pnpm cli --list-profiles                  List all configured profiles

Examples:
  pnpm cli "What is 2+2?"
  pnpm cli --profile claude-sdk "Explain async generators in TypeScript"
  pnpm cli --probe
  pnpm cli --list-profiles
`);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      profile: { type: 'string', short: 'p' },
      probe: { type: 'boolean' },
      'list-profiles': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    printUsage();
    process.exit(0);
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

  const provider = createProvider(config.activeProfile);

  // --probe
  if (values.probe) {
    await runProbe(provider);
    return;
  }

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

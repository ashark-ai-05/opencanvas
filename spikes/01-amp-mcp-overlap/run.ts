import { execute } from '@sourcegraph/amp-sdk';

type Mode = 'mcp-exposed' | 'mcp-hidden';

const PROMPTS = [
  'Find files in the configured filesystem source that mention "processPayment". List the file paths.',
  'Read /tmp/spike-fs-fixture/orders.txt and summarize its contents.',
  'How many files are in /tmp/spike-fs-fixture/ and what do they contain?'
];

async function runMode(mode: Mode, prompt: string) {
  console.log(`\n--- ${mode}: ${prompt.slice(0, 60)}... ---`);
  const enriched = mode === 'mcp-hidden'
    ? `Do not call any MCP tools. Use only the context provided here.\n\nContext:\n` +
      `<files>\n` +
      `/tmp/spike-fs-fixture/sample.txt: this is a fixture file mentioning processPayment\n` +
      `/tmp/spike-fs-fixture/orders.txt: another fixture file mentioning OrderProcessor\n` +
      `</files>\n\n${prompt}`
    : prompt;

  const events: Array<{ type: string; tool?: string; result?: string }> = [];
  for await (const msg of execute({ prompt: enriched })) {
    if (msg.type === 'system')    events.push({ type: 'system' });
    if (msg.type === 'assistant') events.push({ type: 'assistant', tool: extractToolName(msg) });
    if (msg.type === 'result')    events.push({ type: 'result', result: (msg as any).result });
  }
  return events;
}

function extractToolName(msg: any): string | undefined {
  try {
    const blocks = msg.content ?? msg.message?.content ?? [];
    return blocks.filter((b: any) => b.type === 'tool_use').map((b: any) => b.name).join(',') || undefined;
  } catch { return undefined; }
}

async function main() {
  if (!process.env.AMP_API_KEY) {
    console.error('AMP_API_KEY not set. Export the key and re-run.');
    process.exit(2);
  }

  const log: any = { exposed: [], hidden: [] };
  for (const prompt of PROMPTS) {
    log.exposed.push({ prompt, events: await runMode('mcp-exposed', prompt) });
    log.hidden.push({ prompt, events: await runMode('mcp-hidden', prompt) });
  }
  console.log(JSON.stringify(log, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });

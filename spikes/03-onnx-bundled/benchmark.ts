import { loadEmbedder, embed } from './embed.js';

const SAMPLES = [
  'function processOrder(order) { /* validate, charge, ship */ }',
  'The OrderProcessor service handles checkout, retries failures with exponential backoff.',
  'JIRA-1234: Fix race condition in payment retry logic when CardChargeService returns 503.',
  'class AuthMiddleware { handle(req, res, next) { /* verify JWT */ } }',
  'Confluence: Production deploy runbook — rollback steps for service mesh failures.',
  'kubectl get pods -n payments -l app=processor --field-selector=status.phase=Running',
  'ERROR 2026-04-30T13:45:21Z svc=checkout TimeoutError("upstream payment-gateway")',
  'Pull request #4521: refactor OrderProcessor to use repository pattern with mock-friendly seams.',
  'Slack #incidents: customer reports failed checkout — see thread for repro steps and customer ID.',
  'def calculate_total(items, tax_rate, coupon=None): return sum(i.price for i in items) * (1 + tax_rate) - (coupon.discount if coupon else 0)',
];

async function main() {
  const { extractor, coldMs } = await loadEmbedder();
  console.log(`cold start: ${coldMs.toFixed(0)} ms`);

  // Warm-up
  await embed(extractor, 'warmup');

  // Throughput
  const N = 200;
  const corpus = Array.from({ length: N }, (_, i) => SAMPLES[i % SAMPLES.length]);
  const t0 = performance.now();
  for (const text of corpus) await embed(extractor, text);
  const ms = performance.now() - t0;
  const perSec = (N / ms) * 1000;

  console.log(`embedded ${N} chunks in ${ms.toFixed(0)} ms`);
  console.log(`throughput: ${perSec.toFixed(1)} chunks/sec`);

  // Output dim check
  const v = await embed(extractor, 'dim probe');
  console.log(`embedding dim: ${v.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });

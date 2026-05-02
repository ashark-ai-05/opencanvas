/**
 * Health-check runner for a loaded config.
 *
 * Runs probe() on the active provider and prints a human-readable result.
 */
import type { LLMProvider, ProbeResult } from '../core/provider.js';

export async function runProbe(provider: LLMProvider): Promise<void> {
  const start = Date.now();
  let result: ProbeResult;
  try {
    result = await provider.probe();
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const elapsed = Date.now() - start;
  const latency = result.latencyMs ?? elapsed;

  const status = result.ok ? 'OK' : 'FAIL';
  const latencyStr = `${latency}ms`;
  const errorStr = result.error ? ` — ${result.error}` : '';

  console.log(`[${status}] ${provider.name} (${provider.kind}) — ${latencyStr}${errorStr}`);
}

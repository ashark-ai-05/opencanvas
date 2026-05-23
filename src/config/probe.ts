/**
 * Health-check runner for a loaded config.
 *
 * probeProfile() runs both LLM and embed probes in parallel.
 * runProbe() is a legacy helper that prints a single LLM probe result.
 */
import type { LLMProvider, ProbeResult as LLMProbeResult } from '../core/provider.js';
import type { Profile } from './schema.js';
import { createProvider } from '../providers/index.js';
import { createEmbedder } from '../embedders/index.js';

export type ProbeResult = {
  ok: boolean;
  latencyMs?: number;
  dims?: number;
  error?: string;
};

export type ProfileProbeResult = {
  profile: string;
  llm: ProbeResult;
  embed: ProbeResult;
};

export async function probeProfile(profile: Profile): Promise<ProfileProbeResult> {
  const llmProvider = createProvider(profile);
  const embedProvider = createEmbedder(profile);

  const [llm, embed] = await Promise.all([llmProvider.probe(), embedProvider.probe()]);

  return { profile: profile.name, llm, embed };
}

/** Legacy helper: runs a single LLM probe and prints a human-readable result. */
export async function runProbe(provider: LLMProvider): Promise<void> {
  const start = Date.now();
  let result: LLMProbeResult;
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

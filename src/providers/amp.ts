/**
 * AmpAdapter — STUB.
 *
 * The real Amp integration is deferred pending spike 01 (Amp MCP vs pre-fetched context)
 * and spike 02 (ResultEnvelope strictness). This stub proves the interface is wired
 * and returns informative placeholder output.
 *
 * DO NOT import @sourcegraph/amp-sdk here — the real wiring waits for the spike outcome.
 */
import type { LLMProvider, ProviderEvent, QueryRequest, ProbeResult } from '../core/provider.js';

export class AmpAdapter implements LLMProvider {
  readonly id = 'amp';
  readonly name = 'Amp (Sourcegraph)';
  readonly kind = 'agent' as const;

  async *query(_request: QueryRequest): AsyncIterable<ProviderEvent> {
    yield {
      type: 'text-delta',
      text: 'Amp adapter not yet wired — set AMP_API_KEY and complete Spike 02 first.',
    };
    yield { type: 'done' };
  }

  async probe(): Promise<ProbeResult> {
    if (!process.env['AMP_API_KEY']) {
      return { ok: false, error: 'AMP_API_KEY not configured' };
    }
    return { ok: true };
  }
}

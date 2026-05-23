import type { LLMProvider, ProviderEvent, QueryRequest, ProbeResult } from '../../src/core/provider.js';

/**
 * Mock LLMProvider that yields a scripted ProviderEvent[] and records
 * the QueryRequest it received. Used to test the chat route + UIMS
 * adapter without hitting a real model.
 */
export function makeMockProvider(events: ProviderEvent[]): LLMProvider & {
  receivedRequests: QueryRequest[];
} {
  const receivedRequests: QueryRequest[] = [];
  return {
    id: 'mock',
    name: 'Mock Provider',
    kind: 'model',
    receivedRequests,
    async *query(request: QueryRequest) {
      receivedRequests.push(request);
      for (const e of events) yield e;
    },
    async probe(): Promise<ProbeResult> {
      return { ok: true, latencyMs: 0 };
    },
  };
}

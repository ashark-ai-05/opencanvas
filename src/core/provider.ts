import type { CanvasSnapshot } from '../agent/canvas-snapshot.js';

/**
 * Core LLM provider abstraction.
 *
 * Discriminated union over `kind: 'model' | 'agent'`:
 *   - 'model' providers call an LLM API directly and return raw text/thinking deltas
 *   - 'agent' providers own their own tool-calling loop (e.g. Claude Agent SDK, Amp)
 *
 * All providers expose the same `query()` / `probe()` interface so the CLI and
 * any downstream consumer can be provider-agnostic.
 */

export type ProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'tool-call'; toolCallId: string; name: string; input: unknown }
  | {
      type: 'tool-result';
      toolCallId: string;
      name: string;
      output: unknown;
      isError?: boolean;
    }
  | { type: 'error'; message: string }
  | { type: 'done'; usage?: { inputTokens?: number; outputTokens?: number } };

export type QueryRequest = {
  prompt: string;
  systemPrompt?: string;
  canvasSnapshot?: CanvasSnapshot;
  abortSignal?: AbortSignal;
};

export type ProbeResult = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
};

export interface LLMProvider {
  readonly id: string;
  readonly name: string;
  readonly kind: 'model' | 'agent';
  query(request: QueryRequest): AsyncIterable<ProviderEvent>;
  probe(): Promise<ProbeResult>;
}

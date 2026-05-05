import type { CanvasSnapshot } from '../agent/canvas-snapshot.js';

/**
 * Core LLM provider abstraction.
 *
 * Discriminated union over `kind: 'model' | 'agent'`:
 *   - 'model' providers call an LLM API directly and return raw text/reasoning deltas
 *   - 'agent' providers own their own tool-calling loop (e.g. Claude Agent SDK, Amp)
 *
 * All providers expose the same `query()` / `probe()` interface so the CLI and
 * any downstream consumer can be provider-agnostic.
 *
 * Event-name conventions match REPLICATION-PROMPT.md §6:
 *   - `tool-input` (was `tool-call`) — paired with `tool-input-start` and
 *      `tool-input-available` UIMS chunks.
 *   - `reasoning-delta` (was `thinking-delta`) — paired with the
 *      `reasoning-start`/`reasoning-delta`/`reasoning-end` UIMS family.
 *   - `session-started` — providers that own a native session (Claude SDK,
 *      Amp) emit this so the backend can persist the id and rehydrate on the
 *      next turn instead of replaying the full transcript.
 */

export type HistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-input'; id: string; name: string; input: unknown }
  | {
      type: 'tool-result';
      id: string;
      name: string;
      output: unknown;
      isError?: boolean;
    }
  | { type: 'session-started'; sessionId: string }
  | { type: 'error'; message: string }
  | { type: 'done'; usage?: { inputTokens?: number; outputTokens?: number } };

export type QueryRequest = {
  prompt: string;
  systemPrompt?: string;
  /**
   * Prior turns in this conversation. Adapters that own a native session
   * (Claude SDK, Amp) ignore this when `sessionId` rehydrates them; the
   * simpler model adapters (openai, anthropic-direct, ollama, openrouter)
   * render it into their messages array.
   */
  history?: HistoryMessage[];
  /** Provider-native session id from a prior turn; enables rehydration. */
  sessionId?: string;
  canvasSnapshot?: CanvasSnapshot;
  abortSignal?: AbortSignal;
  /**
   * Skip the agent framing (system prompts, canvas tool surface) and just
   * stream the LLM's raw response to a flat prompt. Used by `QaEnricher`,
   * which expects a plain JSON answer rather than a tool-loop reply.
   */
  rawPrompt?: boolean;
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

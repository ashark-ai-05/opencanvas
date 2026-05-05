import type { HistoryMessage } from '../core/provider.js';

/**
 * Render a prior conversation as a plain-text block for adapters that don't
 * have a native session-rehydration story (anthropic-direct, openai,
 * openrouter, ollama). Prepended to the system prompt as transcript context
 * the LLM can refer back to.
 *
 * Spec reference: REPLICATION-PROMPT.md §6 — `history-helpers.ts`.
 *
 * Long histories are truncated head-first (we keep the most recent turns)
 * to stay within sane prompt budgets. Empty input yields an empty string,
 * NOT a stub heading, so the caller can `if (block) blocks.push(block)`.
 */
export function renderHistoryBlock(
  history: HistoryMessage[] | undefined,
  options: { maxChars?: number } = {},
): string {
  if (!history || history.length === 0) return '';
  const max = options.maxChars ?? 16_000;

  const lines = history.map((m) => {
    const speaker = m.role === 'user' ? 'User' : 'Assistant';
    return `${speaker}: ${m.content}`;
  });

  let block = lines.join('\n\n');
  if (block.length > max) {
    // Drop the oldest turns until we fit the budget — recent context is
    // far more relevant than the start of a long thread.
    const truncated: string[] = [];
    let budget = max;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line === undefined) continue;
      if (line.length + 2 > budget) break;
      truncated.unshift(line);
      budget -= line.length + 2;
    }
    block = truncated.join('\n\n');
    if (truncated.length < lines.length) {
      block = `[earlier turns truncated]\n\n${block}`;
    }
  }

  return `Conversation history:\n\n${block}\n\n---\n\nLatest user message follows.`;
}

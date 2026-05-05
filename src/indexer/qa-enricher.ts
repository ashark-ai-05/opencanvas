/**
 * QA enrichment pipeline.
 *
 * For each chunk, asks the active LLM provider to synthesise:
 *   - 12 hypothetical user queries (~the trick that biases the vector
 *     subspace toward the way users actually phrase questions)
 *   - 1 factual response paragraph
 *
 * Then embeds the *queries*, not the body. FTS5 still indexes the raw
 * body so keyword recall is unaffected — only the vector subspace
 * changes.
 *
 * Caches results at `~/.opencanvas/cache/qa/<sha256(body[..6000])>.json`.
 * Cache hit ⇒ 0 LLM calls (idempotency contract, spec §19).
 *
 * Spec: REPLICATION-PROMPT.md §9 + KNOWLEDGE-BASE.md.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { LLMProvider } from '../core/provider.js';

const HASH_TRUNCATE = 6000;
const CACHE_DIR = join(homedir(), '.opencanvas', 'cache', 'qa');
const TARGET_QUERY_COUNT = 12;
const MIN_QUERY_COUNT = 8;
const MAX_QUERY_COUNT = 24;

export type QaPair = {
  /** Exactly 12 queries (truncated from the LLM output if needed). */
  queries: string[];
  response: string;
  /** sha256 of the (truncated) chunk body. Used as the cache filename. */
  contentHash: string;
  model: string;
};

export type QaEnricherOptions = {
  provider: LLMProvider;
  cacheDir?: string;
  /** Optional override for the model label persisted on qa_pairs.model. */
  modelLabel?: string;
};

const SYSTEM_PROMPT = `You convert a snippet of source material into 12 hypothetical user queries
that someone might type to find this snippet, plus a single factual response
paragraph synthesised from the snippet.

Output STRICTLY as JSON with this shape:
{
  "queries": ["query 1", "query 2", ..., "query 12"],
  "response": "factual paragraph"
}

The queries should be diverse — mix natural language, keyword-style, and
hypothetical "how do I X" phrasings. The response should be a faithful
restatement, not invented content.`;

export class QaEnricher {
  /** LLM call count — exposed for the idempotency tests in the orchestrator. */
  llmCallCount = 0;
  /** Cache hit count — symmetrically exposed for tests. */
  cacheHitCount = 0;

  private readonly provider: LLMProvider;
  private readonly cacheDir: string;
  private readonly modelLabel: string;

  constructor(options: QaEnricherOptions) {
    this.provider = options.provider;
    this.cacheDir = options.cacheDir ?? CACHE_DIR;
    this.modelLabel = options.modelLabel ?? options.provider.id;
  }

  /**
   * Enrich a chunk. Returns null on parse / network failure — the
   * orchestrator falls back to raw-body embedding for that chunk.
   */
  async enrich(chunkText: string, docTitle: string): Promise<QaPair | null> {
    const body = chunkText.slice(0, HASH_TRUNCATE);
    const contentHash = sha256(body);
    const cached = await this.readCache(contentHash);
    if (cached) {
      this.cacheHitCount += 1;
      return cached;
    }

    const prompt = `Title: ${docTitle}\n\nSnippet:\n${chunkText}\n\nReturn the JSON object now.`;
    let raw = '';
    try {
      this.llmCallCount += 1;
      for await (const ev of this.provider.query({
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        rawPrompt: true,
      })) {
        if (ev.type === 'text-delta') raw += ev.text;
        else if (ev.type === 'error')
          throw new Error(ev.message);
      }
    } catch (err) {
      console.error(
        `[qa-enricher] provider error for "${docTitle}":`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }

    const parsed = parseQaJson(raw);
    if (!parsed) {
      console.error(
        `[qa-enricher] failed to parse JSON for "${docTitle}" — raw: ${raw.slice(0, 160)}…`,
      );
      return null;
    }

    const pair: QaPair = {
      queries: parsed.queries.slice(0, TARGET_QUERY_COUNT),
      response: parsed.response,
      contentHash,
      model: this.modelLabel,
    };
    await this.writeCache(contentHash, pair);
    return pair;
  }

  /** Build the embedder input from a QA pair (joined queries). */
  static embedText(pair: QaPair): string {
    return pair.queries.join('\n');
  }

  private cachePath(hash: string): string {
    return join(this.cacheDir, `${hash}.json`);
  }

  private async readCache(hash: string): Promise<QaPair | null> {
    const p = this.cachePath(hash);
    if (!existsSync(p)) return null;
    try {
      const raw = await readFile(p, 'utf-8');
      const parsed = JSON.parse(raw) as QaPair;
      // Guard: verify the cached file has the expected shape.
      if (
        !Array.isArray(parsed.queries) ||
        typeof parsed.response !== 'string'
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeCache(hash: string, pair: QaPair): Promise<void> {
    try {
      if (!existsSync(this.cacheDir)) await mkdir(this.cacheDir, { recursive: true });
      await writeFile(this.cachePath(hash), JSON.stringify(pair), 'utf-8');
    } catch {
      // Cache write failures are non-fatal — the next run just re-fetches.
    }
  }
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Parse the LLM's JSON response. Tolerates 8-24 queries (truncates to
 * 12 for storage). Strips ```json fences if the model emitted them.
 * Returns null on schema mismatch.
 */
function parseQaJson(
  raw: string,
): { queries: string[]; response: string } | null {
  let text = raw.trim();
  // Strip code fences the model might add.
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }
  // Some providers wrap JSON in pre-text — find the first {.
  const startIdx = text.indexOf('{');
  if (startIdx > 0) text = text.slice(startIdx);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as { queries?: unknown; response?: unknown };
  if (!Array.isArray(obj.queries)) return null;
  if (typeof obj.response !== 'string') return null;
  const queries = obj.queries.filter(
    (q): q is string => typeof q === 'string' && q.trim().length > 0,
  );
  if (queries.length < MIN_QUERY_COUNT || queries.length > MAX_QUERY_COUNT) {
    return null;
  }
  return {
    queries,
    response: obj.response,
  };
}

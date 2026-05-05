import { describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QaEnricher } from '../../src/indexer/qa-enricher.js';
import type {
  LLMProvider,
  ProviderEvent,
  QueryRequest,
  ProbeResult,
} from '../../src/core/provider.js';

function fakeProvider(text: string): LLMProvider & { calls: QueryRequest[] } {
  const calls: QueryRequest[] = [];
  return {
    id: 'fake',
    name: 'fake',
    kind: 'model',
    calls,
    async *query(req: QueryRequest) {
      calls.push(req);
      const events: ProviderEvent[] = [
        { type: 'text-delta', text },
        { type: 'done' },
      ];
      for (const ev of events) yield ev;
    },
    async probe(): Promise<ProbeResult> {
      return { ok: true };
    },
  };
}

function buildQaJson(): string {
  return JSON.stringify({
    queries: [
      'how does X work',
      'X overview',
      'what is X',
      'X function definition',
      'X internals',
      'X usage',
      'how do I use X',
      'X getting started',
      'X reference',
      'X api',
      'X behavior',
      'X examples',
    ],
    response: 'X is a thing.',
  });
}

describe('QaEnricher', () => {
  it('parses 12 queries + response and returns a QA pair', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strata-qa-'));
    try {
      const provider = fakeProvider(buildQaJson());
      const enricher = new QaEnricher({ provider, cacheDir: dir });
      const pair = await enricher.enrich('chunk text', 'doc title');
      expect(pair).not.toBeNull();
      expect(pair!.queries).toHaveLength(12);
      expect(pair!.response).toContain('X is a thing.');
      expect(enricher.llmCallCount).toBe(1);
      expect(enricher.cacheHitCount).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('cache hit on identical chunk body costs zero LLM calls', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strata-qa-'));
    try {
      const provider = fakeProvider(buildQaJson());
      const enricher = new QaEnricher({ provider, cacheDir: dir });
      await enricher.enrich('repeat', 'doc');
      const enricher2 = new QaEnricher({ provider, cacheDir: dir });
      const pair = await enricher2.enrich('repeat', 'doc');
      expect(pair).not.toBeNull();
      expect(enricher2.llmCallCount).toBe(0);
      expect(enricher2.cacheHitCount).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null when the LLM emits invalid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strata-qa-'));
    try {
      const provider = fakeProvider('not json at all');
      const enricher = new QaEnricher({ provider, cacheDir: dir });
      const pair = await enricher.enrich('chunk', 'doc');
      expect(pair).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('passes rawPrompt: true to the provider', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'strata-qa-'));
    try {
      const provider = fakeProvider(buildQaJson());
      const enricher = new QaEnricher({ provider, cacheDir: dir });
      await enricher.enrich('chunk', 'doc');
      expect(provider.calls[0]!.rawPrompt).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('embedText joins the 12 queries for embedding', () => {
    const text = QaEnricher.embedText({
      queries: ['a', 'b'],
      response: 'r',
      contentHash: 'h',
      model: 'm',
    });
    expect(text).toBe('a\nb');
  });
});

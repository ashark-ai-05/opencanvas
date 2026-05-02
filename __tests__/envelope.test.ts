/**
 * Tests for ResultEnvelope schema and buildEnvelope helper.
 */
import { describe, it, expect } from 'vitest';
import { ResultEnvelopeSchema, buildEnvelope } from '../src/core/envelope.js';

describe('ResultEnvelopeSchema', () => {
  it('parses a valid envelope', () => {
    const envelope = {
      text: 'Hello world',
      providerId: 'claude-agent-sdk',
      completedAt: '2026-05-01T12:00:00.000Z',
    };
    const result = ResultEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.text).toBe('Hello world');
      expect(result.data.providerId).toBe('claude-agent-sdk');
    }
  });

  it('parses an envelope with usage', () => {
    const envelope = {
      text: 'Answer',
      providerId: 'anthropic-direct',
      usage: { inputTokens: 100, outputTokens: 50 },
      completedAt: '2026-05-01T12:00:00.000Z',
    };
    const result = ResultEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.usage?.inputTokens).toBe(100);
      expect(result.data.usage?.outputTokens).toBe(50);
    }
  });

  it('parses an envelope with partial usage (only outputTokens)', () => {
    const envelope = {
      text: 'Answer',
      providerId: 'ollama',
      usage: { outputTokens: 30 },
      completedAt: '2026-05-01T12:00:00.000Z',
    };
    const result = ResultEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });

  it('parses an envelope without usage', () => {
    const envelope = {
      text: 'Answer',
      providerId: 'amp',
      completedAt: '2026-05-01T12:00:00.000Z',
    };
    const result = ResultEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.usage).toBeUndefined();
    }
  });

  it('fails with missing text field', () => {
    const result = ResultEnvelopeSchema.safeParse({
      providerId: 'openai',
      completedAt: '2026-05-01T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('text');
    }
  });

  it('fails with missing providerId field', () => {
    const result = ResultEnvelopeSchema.safeParse({
      text: 'hello',
      completedAt: '2026-05-01T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('providerId');
    }
  });

  it('fails with invalid completedAt (not ISO datetime)', () => {
    const result = ResultEnvelopeSchema.safeParse({
      text: 'hello',
      providerId: 'x',
      completedAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('completedAt');
    }
  });

  it('fails with negative token count', () => {
    const result = ResultEnvelopeSchema.safeParse({
      text: 'hello',
      providerId: 'x',
      usage: { inputTokens: -1 },
      completedAt: '2026-05-01T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('buildEnvelope', () => {
  it('builds a valid envelope', () => {
    const envelope = buildEnvelope('Hello', 'test-provider');
    expect(envelope.text).toBe('Hello');
    expect(envelope.providerId).toBe('test-provider');
    expect(envelope.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(envelope.usage).toBeUndefined();
  });

  it('builds an envelope with usage', () => {
    const envelope = buildEnvelope('Hello', 'test-provider', {
      inputTokens: 10,
      outputTokens: 20,
    });
    expect(envelope.usage?.inputTokens).toBe(10);
    expect(envelope.usage?.outputTokens).toBe(20);
  });

  it('returns an object that passes schema validation', () => {
    const envelope = buildEnvelope('Test text', 'claude-agent-sdk', { inputTokens: 5 });
    const result = ResultEnvelopeSchema.safeParse(envelope);
    expect(result.success).toBe(true);
  });
});

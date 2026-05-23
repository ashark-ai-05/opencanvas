import { describe, it, expect } from 'vitest';
import {
  MarkdownPayload,
  CodeBlockPayload,
  TicketPayload,
  WebEmbedPayload,
  KeyValueCardPayload,
  validatePayloadForKind,
} from '../../src/agent/payloads.js';

describe('payloads', () => {
  describe('MarkdownPayload', () => {
    it('accepts {title, body}', () => {
      const r = MarkdownPayload.safeParse({ title: 't', body: 'b' });
      expect(r.success).toBe(true);
    });
    it('rejects missing title', () => {
      const r = MarkdownPayload.safeParse({ body: 'b' });
      expect(r.success).toBe(false);
    });
    it('rejects non-string body', () => {
      const r = MarkdownPayload.safeParse({ title: 't', body: 42 });
      expect(r.success).toBe(false);
    });
  });

  describe('CodeBlockPayload', () => {
    it('accepts {title, language, code}', () => {
      expect(
        CodeBlockPayload.safeParse({
          title: 'auth middleware',
          language: 'ts',
          code: 'export function authMiddleware() {}',
        }).success,
      ).toBe(true);
    });
    it('accepts optional source', () => {
      expect(
        CodeBlockPayload.safeParse({
          title: 't',
          language: 'ts',
          code: 'x',
          source: 'auth/middleware.ts:12',
        }).success,
      ).toBe(true);
    });
    it('rejects missing language', () => {
      expect(
        CodeBlockPayload.safeParse({ title: 't', code: 'x' }).success,
      ).toBe(false);
    });
  });

  describe('TicketPayload', () => {
    it('accepts {ticketId, title, status}', () => {
      expect(
        TicketPayload.safeParse({
          ticketId: 'TICKET-101',
          title: 'rate-limit hardening',
          status: 'open',
        }).success,
      ).toBe(true);
    });
    it('rejects missing ticketId', () => {
      expect(
        TicketPayload.safeParse({ title: 't', status: 'open' }).success,
      ).toBe(false);
    });
    it('rejects non-string status', () => {
      expect(
        TicketPayload.safeParse({
          ticketId: 'X-1',
          title: 't',
          status: 1,
        }).success,
      ).toBe(false);
    });
  });

  describe('WebEmbedPayload', () => {
    it('accepts a valid URL', () => {
      expect(
        WebEmbedPayload.safeParse({
          title: 'docs',
          url: 'https://example.com/auth',
        }).success,
      ).toBe(true);
    });
    it('rejects a malformed URL', () => {
      expect(
        WebEmbedPayload.safeParse({ title: 'docs', url: 'not-a-url' }).success,
      ).toBe(false);
    });
  });

  describe('KeyValueCardPayload', () => {
    it('accepts {title, fields[]}', () => {
      expect(
        KeyValueCardPayload.safeParse({
          title: 'env',
          fields: [
            { key: 'NODE_ENV', value: 'production' },
            { key: 'PORT', value: '3457' },
          ],
        }).success,
      ).toBe(true);
    });
    it('rejects fields without keys', () => {
      expect(
        KeyValueCardPayload.safeParse({
          title: 'env',
          fields: [{ value: 'production' }],
        }).success,
      ).toBe(false);
    });
    it('accepts an empty fields array (intentional — empty card is valid)', () => {
      expect(
        KeyValueCardPayload.safeParse({ title: 'env', fields: [] }).success,
      ).toBe(true);
    });
  });

  describe('validatePayloadForKind', () => {
    it('returns the parsed payload for a valid kind+payload', () => {
      const r = validatePayloadForKind('markdown', { title: 't', body: 'b' });
      expect(r).toEqual({ title: 't', body: 'b' });
    });
    it('throws for invalid payload', () => {
      expect(() =>
        validatePayloadForKind('markdown', { body: 'b' }),
      ).toThrow();
    });
    it('throws for unknown kind', () => {
      expect(() =>
        // @ts-expect-error testing runtime guard
        validatePayloadForKind('not-a-kind', {}),
      ).toThrow(/unknown widget kind/);
    });
  });
});

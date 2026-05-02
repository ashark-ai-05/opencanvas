/**
 * ResultEnvelope — the structured response shape emitted after a full query.
 *
 * Kept minimal in this slice. The full envelope parser with retry/fallback
 * is deferred to the amendment that resolves spike 02 findings.
 */
import { z } from 'zod';

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});

export const ResultEnvelopeSchema = z.object({
  /** Full text response, assembled from all text-delta events */
  text: z.string(),
  /** Provider that produced this result */
  providerId: z.string(),
  /** Token usage, if reported by the provider */
  usage: UsageSchema.optional(),
  /** ISO-8601 timestamp when the result was completed */
  completedAt: z.string().datetime(),
});

export type ResultEnvelope = z.infer<typeof ResultEnvelopeSchema>;
export type Usage = z.infer<typeof UsageSchema>;

/** Build an envelope from accumulated query results */
export function buildEnvelope(
  text: string,
  providerId: string,
  usage?: { inputTokens?: number; outputTokens?: number },
): ResultEnvelope {
  return ResultEnvelopeSchema.parse({
    text,
    providerId,
    usage,
    completedAt: new Date().toISOString(),
  });
}

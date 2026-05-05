/**
 * Shared types for agent tool implementations.
 *
 * Two cross-cutting concerns:
 *
 * 1. `TextOnlyCallToolResult` — every opencanvas tool returns single-text
 *    content (never images or embedded resources). Narrowing the SDK's
 *    `CallToolResult` to this shape lets callers do `r.content[0].text`
 *    without union narrowing.
 *
 * 2. `WithOptionalArgs` — the SDK's `InferShape<T>` maps Zod shapes to
 *    `{ [K]: T[K]['_output'] }`, which preserves `| undefined` in value
 *    positions but does NOT mark keys as TS-optional. So `z.number().optional()`
 *    yields `{ limit: number | undefined }` (key required) instead of
 *    `{ limit?: number }`. We override the inferred handler signature to
 *    use a hand-written args type with proper `?` keys; runtime is unchanged.
 */
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { ZodRawShape } from 'zod';

export interface TextOnlyCallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/**
 * Override the handler signature on an SDK tool definition with a custom
 * args type that correctly marks optional inputs as TS-optional. Use it as:
 *
 *   type MyToolDef = WithArgs<typeof inputShape, MyArgs>;
 *   return def as unknown as MyToolDef;
 */
export type WithArgs<Shape extends ZodRawShape, Args> = Omit<
  SdkMcpToolDefinition<Shape>,
  'handler'
> & {
  handler: (args: Args, extra: unknown) => Promise<TextOnlyCallToolResult>;
};

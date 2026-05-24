/**
 * Bridge: user-configured MCP sources → AI SDK `Tool` objects.
 *
 * In v1 the Claude Agent SDK natively spoke MCP and discovered external
 * tools through its own protocol layer. AI SDK 6 doesn't ship an MCP
 * client of its own (the `experimental_createMCPClient` from v5 was
 * removed), so we build the bridge ourselves with the existing
 * `@modelcontextprotocol/sdk` client we already use in `src/mcp/transport.ts`.
 *
 * Per turn:
 *   1. For each source in `profile.sources`, connect via `createMcpClient`
 *   2. `client.listTools()` → enumerate the source's tools
 *   3. For each tool, wrap it as an AI SDK `tool({ description, inputSchema,
 *      execute })` whose `execute` proxies to `client.callTool`
 *   4. Key the wrapped tool as `mcp__<sourceId>__<toolName>` so it matches
 *      the convention v1 used (the system prompt's "External tools" block
 *      tells the model to call them that way)
 *   5. Return a `close()` so the chat route can drop all clients when the
 *      turn finishes (`streamText({ onFinish: ... })`)
 *
 * Failure mode: any source that fails to connect or list-tools is logged
 * and skipped. The other sources still load. The agent gets fewer tools
 * but the turn isn't blocked.
 *
 * See docs/plans/unified-agent.md Phase 3.
 */
import { tool, jsonSchema, type Tool } from 'ai';
import { createMcpClient } from '../mcp/transport.js';
import type { SourceConfig } from '../config/schema.js';
import type { ExternalMcpSourceHint } from './system-prompt.js';

export interface McpToolBundle {
  /** AI SDK tools, keyed by `mcp__<sourceId>__<toolName>`. */
  tools: Record<string, Tool>;
  /** System-prompt hints — one per source, with the tool names exposed. */
  sources: ExternalMcpSourceHint[];
  /** Close every underlying MCP client. Safe to call multiple times. */
  close: () => Promise<void>;
}

const EMPTY_BUNDLE: McpToolBundle = {
  tools: {},
  sources: [],
  close: async () => {},
};

export async function loadExternalMcpTools(
  configs: readonly SourceConfig[],
): Promise<McpToolBundle> {
  if (configs.length === 0) return EMPTY_BUNDLE;

  const tools: Record<string, Tool> = {};
  const sources: ExternalMcpSourceHint[] = [];
  const closers: Array<() => Promise<void>> = [];

  for (const config of configs) {
    try {
      const client = await createMcpClient(config);
      closers.push(async () => {
        await client.close().catch(() => {});
      });

      const listed = await client.listTools();
      const toolNames: string[] = [];

      for (const t of listed.tools) {
        const key = `mcp__${config.id}__${t.name}`;
        toolNames.push(t.name);

        // MCP tool inputSchemas are JSON Schema (Draft 7-ish). AI SDK's
        // `jsonSchema()` wraps it into a Schema<T> that satisfies the
        // `FlexibleSchema` accepted by `tool({inputSchema})`.
        const schema = jsonSchema(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (t.inputSchema ?? { type: 'object', properties: {} }) as any,
        );

        tools[key] = tool({
          description:
            t.description ?? `Tool '${t.name}' from MCP source '${config.id}'`,
          inputSchema: schema,
          execute: async (args, opts) => {
            const result = await client.callTool({
              name: t.name,
              arguments: args as Record<string, unknown>,
            }, undefined, opts.abortSignal ? { signal: opts.abortSignal } : undefined);
            // MCP's CallToolResult has `content: ToolResultContent[]` and
            // `isError?: boolean`. Return it as-is — AI SDK will JSON-stringify
            // it into the tool-result block the model sees.
            return result;
          },
        });
      }

      sources.push({ name: config.id, toolNames });
    } catch (e) {
      console.warn(
        `[mcp-integration] skipped source '${config.id}' (${config.transport}):`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  let closed = false;
  return {
    tools,
    sources,
    close: async () => {
      if (closed) return;
      closed = true;
      await Promise.all(closers.map((fn) => fn().catch(() => {})));
    },
  };
}

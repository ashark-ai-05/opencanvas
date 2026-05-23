import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Source, SourceTool } from '../core/source.js';

/**
 * Implements the public Source contract on top of a connected MCP Client.
 * Holds the live transport handle for callTool / close.
 */
export class MCPSource implements Source {
  readonly id: string;
  readonly name: string;
  health: 'connected' | 'disconnected' | 'degraded' = 'connected';
  tools: SourceTool[] = [];

  private readonly client: Client;

  constructor(id: string, name: string, client: Client) {
    this.id = id;
    this.name = name;
    this.client = client;
  }

  /**
   * Discovers available tools. Updates `this.tools` and returns this
   * source for chaining. On error, sets health to 'degraded' and rethrows.
   */
  async introspect(): Promise<this> {
    try {
      const response = await this.client.listTools();
      this.tools = (response.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      this.health = 'connected';
      return this;
    } catch (e) {
      this.health = 'degraded';
      throw e;
    }
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    return this.client.callTool({ name, arguments: args as Record<string, unknown> });
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } finally {
      this.health = 'disconnected';
    }
  }
}

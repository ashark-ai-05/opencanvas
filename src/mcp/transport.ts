import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { SourceConfig } from '../config/schema.js';

const CLIENT_NAME = 'opencanvas';
const CLIENT_VERSION = '0.1.0';

/**
 * Connect to an MCP server described by `config`. Returns a Client ready
 * for listTools/callTool. Caller is responsible for `client.close()`.
 *
 * Throws on transport-level failures (process spawn, network, handshake).
 */
export async function createMcpClient(config: SourceConfig): Promise<Client> {
  const client = new Client(
    { name: CLIENT_NAME, version: CLIENT_VERSION },
    { capabilities: {} }
  );

  switch (config.transport) {
    case 'stdio': {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
      });
      await client.connect(transport);
      return client;
    }
    case 'sse': {
      const transport = new SSEClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      });
      await client.connect(transport);
      return client;
    }
    case 'http': {
      const transport = new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      });
      await client.connect(transport);
      return client;
    }
  }
}

/**
 * Result kinds — the discriminator that drives widget dispatch in Plan 5+.
 * Defined here in Plan 2 so downstream plans don't duplicate this list.
 * See design spec §3 for the full taxonomy.
 */
export type ResultKind =
  | 'text-document'
  | 'wiki-page'
  | 'code-file'
  | 'code-symbol'
  | 'code-diff'
  | 'ticket'
  | 'log-stream'
  | 'k8s-resource'
  | 'web-page'
  | 'image'
  | 'table-row-set'
  | 'metric-series'
  | 'chat-message'
  | 'runbook'
  | 'dashboard-embed';

/**
 * A single MCP-exposed tool, captured raw at introspection time.
 * Plan 3 maps these onto typed Capability verbs (search/fetch/list/subscribe);
 * here we just surface what the server tells us.
 */
export type SourceTool = {
  name: string;
  description?: string;
  inputSchema: unknown; // JSON Schema as returned by MCP listTools()
};

/**
 * A configured MCP server, post-introspection.
 * The transport-level connection lives in MCPSource (src/mcp/source.ts);
 * Source is the public-facing data shape consumers see.
 */
export type Source = {
  id: string;
  name: string;
  health: 'connected' | 'disconnected' | 'degraded';
  tools: SourceTool[];
};

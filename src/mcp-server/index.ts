#!/usr/bin/env node
/**
 * External OpenCanvas MCP server.
 *
 * Exists for the `amp` profile path: Sourcegraph Amp can't host
 * in-process MCP tools the way the Claude SDK can, so OpenCanvas also ships
 * an external MCP stdio server that proxies the same tool surface back
 * to the running backend via `/v1/fetch`, `/v1/web-search`,
 * `/v1/canvas-snapshot`.
 *
 * Spec: REPLICATION-PROMPT.md §10.E.
 *
 * Run via: `pnpm mcp` (the Amp adapter spawns this as a stdio child).
 *
 * Required env:
 *   OPENCANVAS_BACKEND_URL  default http://127.0.0.1:3457
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const BACKEND_URL = process.env['OPENCANVAS_BACKEND_URL'] ?? 'http://127.0.0.1:3457';

const SearchKbArgs = z.object({
  query: z.string(),
  queries: z.array(z.string()).max(6).optional(),
  limit: z.number().int().positive().max(25).optional(),
  project: z.string().optional(),
});
const FetchResultArgs = z.object({ id: z.string() });
const WebSearchArgs = z.object({
  query: z.string(),
  limit: z.number().int().positive().max(10).optional(),
});
const ReadCanvasArgs = z.object({}).strict();
const ReadWidgetArgs = z.object({ id: z.string() });

async function backendGet(path: string): Promise<unknown> {
  const res = await fetch(`${BACKEND_URL}${path}`);
  if (!res.ok) {
    throw new Error(
      `OpenCanvas backend GET ${path} → ${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}

async function backendPost(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `OpenCanvas backend POST ${path} → ${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}

const server = new Server(
  { name: 'opencanvas', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: 'search_kb',
    description:
      'Search indexed knowledge (code, docs, tickets, prior conversations). Pass query as the canonical phrasing AND 2-4 semantic variants as queries[] for better recall.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        queries: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        limit: { type: 'integer', minimum: 1, maximum: 25 },
        project: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_result',
    description: 'Fetch the full payload for a search result by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'web_search',
    description:
      'Search the public web via Tavily. Returns "not configured" if TAVILY_API_KEY is unset.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_canvas',
    description:
      'Read a summary of every widget currently on the canvas (id, kind, role, title, summary).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_widget',
    description: 'Read the full payload of one widget by id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = req.params.arguments ?? {};
  try {
    switch (name) {
      case 'search_kb': {
        const parsed = SearchKbArgs.parse(args);
        const out = await backendPost('/v1/search', parsed);
        return {
          content: [{ type: 'text', text: JSON.stringify(out) }],
        };
      }
      case 'fetch_result': {
        const parsed = FetchResultArgs.parse(args);
        const out = await backendGet(
          `/v1/fetch?id=${encodeURIComponent(parsed.id)}`,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(out) }],
        };
      }
      case 'web_search': {
        const parsed = WebSearchArgs.parse(args);
        const out = await backendPost('/v1/web-search', parsed);
        return {
          content: [{ type: 'text', text: JSON.stringify(out) }],
        };
      }
      case 'read_canvas': {
        ReadCanvasArgs.parse(args);
        const out = await backendGet('/v1/canvas-snapshot');
        return {
          content: [{ type: 'text', text: JSON.stringify(out) }],
        };
      }
      case 'read_widget': {
        const parsed = ReadWidgetArgs.parse(args);
        const out = await backendPost('/v1/canvas-snapshot', { id: parsed.id });
        return {
          content: [{ type: 'text', text: JSON.stringify(out) }],
        };
      }
      default:
        return {
          content: [{ type: 'text', text: `unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: 'text', text: message }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

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
const AddTaskArgs = z.object({
  title: z.string().min(1),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().optional(),
});
const RegisterWidgetKindArgs = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9-]{2,30}$/),
  label: z.string().min(1).max(40),
  description: z.string().min(20),
  srcdoc: z.string().min(50),
  default_size: z.object({
    w: z.number().int().min(120).max(1200),
    h: z.number().int().min(80).max(900),
  }).optional(),
});
const CompleteTaskArgs = z.object({ id: z.string() });
const ReadNotesArgs = z.object({}).strict();
const AppendToNotesArgs = z.object({
  text: z.string(),
  separator: z.string().optional(),
});

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

async function backendPatch(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `OpenCanvas backend PATCH ${path} → ${res.status} ${res.statusText}`,
    );
  }
  return res.json();
}

async function backendPut(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `OpenCanvas backend PUT ${path} → ${res.status} ${res.statusText}`,
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
  {
    name: 'add_task',
    description:
      'Add a task to the user\'s notebook. Use when the user asks to remember a TODO, schedule something, or "don\'t let me forget X". due_date is YYYY-MM-DD; resolve relative dates ("Friday", "next Monday", "tomorrow") against today\'s date BEFORE calling. Returns the new task with its assigned id.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        due_date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        notes: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_task',
    description:
      "Mark a task done by id. Use after the user says they finished something. Use list/read tools first if you don't have the id.",
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'read_notes',
    description:
      "Read the user's persistent notepad. The notepad is markdown — anything they've been jotting across all conversations. Use this when answering questions about their work-in-progress, ideas, or context they've captured.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'append_to_notes',
    description:
      "Append markdown text to the user's notepad. Use to capture decisions, summaries, or notes the user wants saved. Default separator is two newlines (paragraph break) — pass a different separator only if you have a reason.",
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        separator: { type: 'string' },
      },
      required: ['text'],
    },
  },
  {
    name: 'register_widget_kind',
    description:
      'Register a new widget kind at runtime so future place_widget calls can use it with just a small payload (instead of resending the full HTML each time). Use for REPEAT patterns ("stock-ticker", "weather-card") where the user will want multiple instances. For one-shot novel renders, use the built-in `html` widget instead.\n\nThe registered widget renders in a sandboxed iframe (allow-scripts only). srcdoc must read props from `window.opencanvas?.props` on load + listen for "opencanvas:props" events for live updates. Returns the registered descriptor on success, or an error if the kind already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,30}$' },
        label: { type: 'string', minLength: 1, maxLength: 40 },
        description: { type: 'string', minLength: 20 },
        srcdoc: { type: 'string', minLength: 50 },
        default_size: {
          type: 'object',
          properties: {
            w: { type: 'integer', minimum: 120, maximum: 1200 },
            h: { type: 'integer', minimum: 80, maximum: 900 },
          },
          required: ['w', 'h'],
        },
      },
      required: ['kind', 'label', 'description', 'srcdoc'],
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
      case 'add_task': {
        const parsed = AddTaskArgs.parse(args);
        const out = await backendPost('/v1/tasks', {
          title: parsed.title,
          dueDate: parsed.due_date ?? null,
          notes: parsed.notes ?? null,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, task: out }) }],
        };
      }
      case 'complete_task': {
        const parsed = CompleteTaskArgs.parse(args);
        const out = await backendPatch(`/v1/tasks/${encodeURIComponent(parsed.id)}`, { done: true });
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, task: out }) }],
        };
      }
      case 'read_notes': {
        ReadNotesArgs.parse(args);
        const out = await backendGet('/v1/notepad');
        const note = out as { body: string; updatedAt: number };
        if (!note.body) {
          return { content: [{ type: 'text', text: '(notepad is empty)' }] };
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ body: note.body, updated_at: note.updatedAt }) }],
        };
      }
      case 'append_to_notes': {
        const parsed = AppendToNotesArgs.parse(args);
        // Read current note, append, save via PUT
        const current = await backendGet('/v1/notepad') as { body: string; updatedAt: number };
        const separator = parsed.separator ?? '\n\n';
        const newBody = current.body ? current.body + separator + parsed.text : parsed.text;
        const out = await backendPut('/v1/notepad', { body: newBody });
        const saved = out as { body: string; updatedAt: number };
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, body: saved.body, updated_at: saved.updatedAt }) }],
        };
      }
      case 'register_widget_kind': {
        const parsed = RegisterWidgetKindArgs.parse(args);
        const body: Record<string, unknown> = {
          kind: parsed.kind,
          label: parsed.label,
          description: parsed.description,
          renderer: {
            type: 'iframe',
            sandbox: 'allow-scripts',
            srcdoc: parsed.srcdoc,
            ...(parsed.default_size ? { defaultSize: parsed.default_size } : {}),
          },
        };
        const out = await backendPost('/v1/canvas/widget-kinds', body);
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, descriptor: out }) }],
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

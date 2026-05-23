#!/usr/bin/env node
/**
 * Demo MCP server for testing opencanvas integration.
 *
 * Exposes a fake "company knowledge base" with five wiki pages and five
 * tickets. Cross-references between them are intentional — pages
 * mention TICKET-101 etc., tickets reference page ids — so this is
 * also a useful target for the future cross-source link resolver
 * (Plan 3e).
 *
 * Tools exposed (MCP):
 *   search_pages(query, limit?)
 *   fetch_page(id)
 *   list_pages()
 *   search_tickets(query, status?, assignee?, limit?)
 *   fetch_ticket(id)
 *   list_tickets(status?)
 *
 * Transport: stdio.
 *
 * To use with opencanvas:
 *   1. Add to ~/.opencanvas/config.json under profiles[].sources:
 *
 *      {
 *        "id": "demo-kb",
 *        "name": "Demo Knowledge Base",
 *        "transport": "stdio",
 *        "command": "pnpm",
 *        "args": ["tsx", "examples/demo-mcp-server.ts"]
 *      }
 *
 *   2. Probe and try it:
 *      pnpm cli --probe-sources
 *      pnpm cli --list-tools demo-kb
 *      pnpm cli --call-tool demo-kb search_pages '{"query":"auth"}'
 *      pnpm cli --call-tool demo-kb fetch_ticket '{"id":"TICKET-101"}'
 *
 * To run standalone (debugging the server itself):
 *   pnpm tsx examples/demo-mcp-server.ts
 *   # then type JSON-RPC messages on stdin, or pipe them in
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ──────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────

type Page = {
  id: string;
  title: string;
  body: string;
  tags: string[];
};

type Ticket = {
  id: string;
  title: string;
  status: 'todo' | 'in-progress' | 'done';
  assignee: string;
  description: string;
};

const PAGES: Page[] = [
  {
    id: 'auth-architecture',
    title: 'Authentication Architecture',
    body: `Our authentication flow uses JWT tokens issued by the auth-svc.

Clients exchange OAuth credentials for a short-lived access token (1h)
and a refresh token (30d). See TICKET-101 for the current OAuth rollout.

The token is validated by the API gateway on every request. JWKS is
cached for 24h. Token revocation is handled via a Redis blocklist.`,
    tags: ['auth', 'security', 'gateway'],
  },
  {
    id: 'deploy-runbook',
    title: 'Production Deploy Runbook',
    body: `To deploy auth-svc to production:

  1. Tag the release: git tag vX.Y.Z
  2. Push the tag:    git push origin vX.Y.Z
  3. Watch pipeline:  ArgoCD will sync within 5 minutes
  4. Verify:          curl https://api.example.com/healthz

Rollback procedure: see TICKET-102 for the migration approach.
For incidents, page on-call via PagerDuty.`,
    tags: ['ops', 'deploy', 'runbook'],
  },
  {
    id: 'onboarding-guide',
    title: 'New Engineer Onboarding',
    body: `Welcome! Read these in order:

  1. Authentication Architecture (auth-architecture)
  2. Database Schema (database-schema)
  3. API Gateway Configuration (api-gateway-config)
  4. Deploy Runbook (deploy-runbook)

Set up your dev environment per TICKET-105.

Any questions, ping #engineering on Slack.`,
    tags: ['onboarding', 'new-hire'],
  },
  {
    id: 'database-schema',
    title: 'Database Schema Reference',
    body: `Core tables:

  users(id, email, created_at, plan_tier)        primary key, indexed on email
  orders(id, user_id FK, total_cents, status, created_at)
  payments(id, order_id FK, processor_id, amount, status)

The orders table was migrated to Postgres 16 in TICKET-102.
Foreign keys cascade on delete. All timestamps are UTC.`,
    tags: ['database', 'schema', 'reference'],
  },
  {
    id: 'api-gateway-config',
    title: 'API Gateway Configuration',
    body: `The gateway uses Envoy in front of all services. Route config:

  /api/v1/auth/*    → auth-svc:8080
  /api/v1/orders/*  → orders-svc:8080
  /api/v1/users/*   → users-svc:8080

Rate limits: 100 req/min per user (JWT-keyed), 1000 req/min per IP.
Token validation per Authentication Architecture (auth-architecture).
Refactor planned in TICKET-103.`,
    tags: ['gateway', 'config', 'routing'],
  },
];

const TICKETS: Ticket[] = [
  {
    id: 'TICKET-101',
    title: 'Add OAuth support to login flow',
    status: 'in-progress',
    assignee: 'alice',
    description: `Current login uses username/password only. Add OAuth via Google + GitHub.

Spec: see Authentication Architecture (auth-architecture).

Acceptance criteria:
  - /login page shows "Sign in with Google" and "Sign in with GitHub"
  - Successful OAuth issues the same JWT as username/password flow
  - E2E test in test/e2e/oauth.test.ts passes

ETA: end of sprint.`,
  },
  {
    id: 'TICKET-102',
    title: 'Migrate orders table to Postgres 16',
    status: 'done',
    assignee: 'bob',
    description: `Orders table is on Postgres 13, blocking some JSON-path queries.

Migration completed via pg_dump + restore. Index rebuild took 4h.
Rollback plan documented in Deploy Runbook (deploy-runbook).
Verified zero data loss; closing.`,
  },
  {
    id: 'TICKET-103',
    title: 'Refactor API gateway routes',
    status: 'todo',
    assignee: 'charlie',
    description: `Current routing config in API Gateway Configuration (api-gateway-config) has
grown organically. Want to:

  - Group routes by service
  - Remove dead routes (audit needed)
  - Document any auth exceptions

Targeting Q3.`,
  },
  {
    id: 'TICKET-104',
    title: 'Investigate auth-svc latency spike',
    status: 'in-progress',
    assignee: 'alice',
    description: `Pager fired at 14:32. Auth-svc p99 latency hit 2s for ~10min.

Initial suspicion: Redis blocklist (Authentication Architecture, auth-architecture).
Need to check: Redis CPU during incident, JWKS cache hit rate, downstream svc health.
Currently profiling with pprof.`,
  },
  {
    id: 'TICKET-105',
    title: 'Update onboarding documentation',
    status: 'done',
    assignee: 'dana',
    description: `Onboarding doc was missing local dev setup steps.

Added: docker-compose, env vars, pnpm install instructions.
Reviewed by 3 new hires; closed.`,
  },
];

// ──────────────────────────────────────────────────────────────────────
// Search helpers
// ──────────────────────────────────────────────────────────────────────

function searchPages(query: string, limit: number): Page[] {
  const q = query.toLowerCase();
  return PAGES.filter(
    (p) =>
      p.title.toLowerCase().includes(q) ||
      p.body.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q))
  ).slice(0, limit);
}

function searchTickets(
  query: string,
  filters: { status?: string; assignee?: string },
  limit: number
): Ticket[] {
  const q = query.toLowerCase();
  return TICKETS.filter((t) => {
    if (filters.status && t.status !== filters.status) return false;
    if (filters.assignee && t.assignee !== filters.assignee) return false;
    return (
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q)
    );
  }).slice(0, limit);
}

// ──────────────────────────────────────────────────────────────────────
// MCP server
// ──────────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'demo-kb', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search_pages',
      description:
        'Search wiki pages by query string. Searches title, body, and tags. Case-insensitive substring match.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Substring to search for' },
          limit: {
            type: 'number',
            description: 'Maximum results to return',
            default: 10,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'fetch_page',
      description: 'Get a wiki page by its id, including the full body.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Page id, e.g. "auth-architecture"',
          },
        },
        required: ['id'],
      },
    },
    {
      name: 'list_pages',
      description: 'List all wiki pages with their ids, titles, and tags.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'search_tickets',
      description:
        'Search tickets by query, optionally filtered by status or assignee.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Substring to search for' },
          status: {
            type: 'string',
            enum: ['todo', 'in-progress', 'done'],
            description: 'Filter by status',
          },
          assignee: {
            type: 'string',
            description: 'Filter by assignee username',
          },
          limit: {
            type: 'number',
            description: 'Maximum results',
            default: 10,
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'fetch_ticket',
      description: 'Get a ticket by its id (e.g. "TICKET-101").',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Ticket id' },
        },
        required: ['id'],
      },
    },
    {
      name: 'list_tickets',
      description: 'List all tickets, optionally filtered by status.',
      inputSchema: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['todo', 'in-progress', 'done'],
            description: 'Filter by status',
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  function asString(v: unknown): string {
    return typeof v === 'string' ? v : String(v ?? '');
  }
  function asNumber(v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  function jsonText(value: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(value, null, 2),
        },
      ],
    };
  }
  function errorText(message: string) {
    return {
      content: [{ type: 'text' as const, text: message }],
      isError: true,
    };
  }

  try {
    switch (name) {
      case 'search_pages': {
        const results = searchPages(asString(a.query), asNumber(a.limit, 10));
        return jsonText(
          results.map((p) => ({
            id: p.id,
            title: p.title,
            tags: p.tags,
            snippet: p.body.slice(0, 200) + (p.body.length > 200 ? '…' : ''),
          }))
        );
      }
      case 'fetch_page': {
        const id = asString(a.id);
        const page = PAGES.find((p) => p.id === id);
        if (!page) return errorText(`Page not found: ${id}`);
        return jsonText(page);
      }
      case 'list_pages': {
        return jsonText(
          PAGES.map((p) => ({ id: p.id, title: p.title, tags: p.tags }))
        );
      }
      case 'search_tickets': {
        const results = searchTickets(
          asString(a.query),
          {
            status: typeof a.status === 'string' ? a.status : undefined,
            assignee: typeof a.assignee === 'string' ? a.assignee : undefined,
          },
          asNumber(a.limit, 10)
        );
        return jsonText(results);
      }
      case 'fetch_ticket': {
        const id = asString(a.id);
        const ticket = TICKETS.find((t) => t.id === id);
        if (!ticket) return errorText(`Ticket not found: ${id}`);
        return jsonText(ticket);
      }
      case 'list_tickets': {
        const status =
          typeof a.status === 'string' ? a.status : undefined;
        const results = status
          ? TICKETS.filter((t) => t.status === status)
          : TICKETS;
        return jsonText(
          results.map((t) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            assignee: t.assignee,
          }))
        );
      }
      default:
        return errorText(`Unknown tool: ${name}`);
    }
  } catch (e) {
    return errorText(
      `Error executing ${name}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
});

// ──────────────────────────────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);

// Log to stderr so stdout stays clean for the MCP protocol.
console.error('[demo-kb] MCP server running on stdio');

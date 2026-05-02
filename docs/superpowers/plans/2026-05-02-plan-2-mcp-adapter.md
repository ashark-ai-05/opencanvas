# Plan 2 — MCP Adapter and Source Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic MCP (Model Context Protocol) adapter that turns any user-configured MCP server into a typed `Source` exposing introspectable tools, validated via CLI commands and an integration test against the official filesystem MCP server.

**Architecture:** Use `@modelcontextprotocol/sdk` (the official TypeScript SDK) for transport. Profile config gains a `sources: SourceConfig[]` array (parallel to `llm` and `embed`). Each `SourceConfig` describes a single MCP server (transport type, command/url, args, env). At runtime a `SourceRegistry` connects configured sources, calls `client.listTools()` to introspect, and exposes typed `Source` objects backed by `MCPSource` adapters. Integration is validated against `@modelcontextprotocol/server-filesystem` running on stdio over a fixture directory.

**Tech Stack:** Node.js 24+ · TypeScript · `@modelcontextprotocol/sdk` (Client + StdioClientTransport + SSEClientTransport) · existing Zod / Vitest / tsx infrastructure.

**References:**
- Design spec: `docs/superpowers/specs/2026-05-02-llm-wiki-design.md` §3 (`Source`, `Capability`, `Result`, `Skill`), §4 (live-only sources), §5 (Source connection)
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- Filesystem reference server: https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem (npm: `@modelcontextprotocol/server-filesystem`)

**Out of scope (deferred):**
- Mapping MCP tool names to our typed `Capability` verbs (`search` / `fetch` / `list` / `subscribe`) — Plan 3, when the index orchestrator actually consumes Capabilities for retrieval. v2 ships raw tool listing only.
- Typed `Result<K>` materialisation (Plan 3 — indexers produce them; Plan 5 — agent loop consumes them)
- Cross-source link resolver (Plan 3)
- MCP wired into space-agent's chat (Plan 1.6 — uses sources from the registry as agent context)
- Capability hints / `source-manifest.json` overrides (Plan 3 — when we know which servers need them)
- Streaming subscribes for ELK / k8s sources (Plan 3 — needs a consumer)

This plan is intentionally minimal: prove the wire (configure → connect → list → call) end-to-end. Type discipline (Capability mapping, Result kinds) is layered on in Plan 3 when consumers exist.

---

## File structure

### New files

```
src/
  core/
    source.ts                  # Source, SourceTool, ResultKind enum (placeholder for Plan 3)
  mcp/
    transport.ts               # createMcpClient(config) — stdio | sse | http
    source.ts                  # MCPSource — implements Source against an MCP client
    registry.ts                # SourceRegistry — connects configured Sources, manages lifecycle
__tests__/
  mcp.test.ts                  # unit tests: SourceConfig schema, registry CRUD with FakeSource
  mcp-fs.integration.test.ts   # integration: spawns @modelcontextprotocol/server-filesystem
```

### Modified files

```
package.json                   # add deps: @modelcontextprotocol/sdk
                               # add devDeps: @modelcontextprotocol/server-filesystem
src/config/schema.ts           # add `sources: z.array(SourceConfigSchema).default([])` to ProfileSchema
src/config/loader.ts           # update DEFAULT_CONFIG with empty sources: []
src/cli.ts                     # add --list-sources, --probe-sources, --list-tools, --call-tool
README.md                      # MCP section
__tests__/config.test.ts       # cover the new sources field
```

### Files explicitly NOT modified

`src/core/provider.ts`, `src/core/embedding-provider.ts`, `src/storage/**`, `src/embedders/**`, `src/providers/**`, the customware tree — Plan 1', Plan 1, and Plan 1.5 deliverables stay stable.

---

## Task 0: Add MCP SDK and filesystem reference server

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add deps**

Edit `package.json`:

```json
"dependencies": {
  // ... existing ...
  "@modelcontextprotocol/sdk": "^1.0.0"
}
```

```json
"devDependencies": {
  // ... existing ...
  "@modelcontextprotocol/server-filesystem": "^2025.5.0"
}
```

If those exact versions don't resolve cleanly, use `*` to take whatever is current — this is internal dev infra, not a production pin.

- [ ] **Step 2: Install**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm install
```

Expected: clean install. Both packages are pure JS (no native modules).

- [ ] **Step 3: Verify typecheck still passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add package.json pnpm-lock.yaml
git commit -m "chore: add @modelcontextprotocol/sdk and filesystem server"
```

---

## Task 1: Core types — Source, SourceTool, ResultKind

**Files:**
- Create: `src/core/source.ts`

We define the minimum surface for v2: `Source` exposes connection state, configured ID/name, and a list of tools (raw, as MCP returns them). The `Capability` verb mapping and typed `Result<K>` come in Plan 3 when consumers need them.

We DO define `ResultKind` here as the literal-union enum from spec §3, because (a) the discriminator never changes and (b) Plan 3 will reference it from multiple files. Defining it once now avoids a refactor later.

- [ ] **Step 1: Write a small test for the type exports**

Create `__tests__/mcp.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { Source, SourceTool, ResultKind } from '../src/core/source.js';

describe('core/source types', () => {
  it('exports a Source type with the expected shape', () => {
    // Compile-time check via type assertion. If the type's missing fields
    // or has wrong types, this won't compile.
    const s: Source = {
      id: 'test',
      name: 'Test Source',
      health: 'connected',
      tools: [],
    };
    expect(s.id).toBe('test');
  });

  it('SourceTool carries name, description, inputSchema', () => {
    const t: SourceTool = {
      name: 'read_file',
      description: 'Read file contents',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    };
    expect(t.name).toBe('read_file');
  });

  it('ResultKind union accepts all 15 kinds', () => {
    const kinds: ResultKind[] = [
      'text-document',
      'wiki-page',
      'code-file',
      'code-symbol',
      'code-diff',
      'ticket',
      'log-stream',
      'k8s-resource',
      'web-page',
      'image',
      'table-row-set',
      'metric-series',
      'chat-message',
      'runbook',
      'dashboard-embed',
    ];
    expect(kinds).toHaveLength(15);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test mcp
```

Expected: FAIL — `src/core/source.js` cannot be resolved.

- [ ] **Step 3: Create `src/core/source.ts`**

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test mcp
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/core/source.ts __tests__/mcp.test.ts
git commit -m "feat(core): Source, SourceTool, ResultKind types"
```

---

## Task 2: SourceConfig schema in ProfileSchema

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `src/config/loader.ts`
- Modify: `__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `__tests__/config.test.ts`:

```typescript
describe('Profile.sources', () => {
  it('defaults sources to an empty array', () => {
    const profile = ProfileSchema.parse({
      name: 'test',
      llm: { provider: 'claude-agent-sdk' },
    });
    expect(profile.sources).toEqual([]);
  });

  it('accepts a stdio-transport MCP source', () => {
    const profile = ProfileSchema.parse({
      name: 'test',
      llm: { provider: 'claude-agent-sdk' },
      sources: [
        {
          id: 'fs',
          name: 'Filesystem',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        },
      ],
    });
    expect(profile.sources).toHaveLength(1);
    expect(profile.sources[0].id).toBe('fs');
  });

  it('accepts an http-transport MCP source', () => {
    const profile = ProfileSchema.parse({
      name: 'test',
      llm: { provider: 'claude-agent-sdk' },
      sources: [
        {
          id: 'remote',
          name: 'Remote MCP',
          transport: 'http',
          url: 'https://example.com/mcp',
        },
      ],
    });
    expect(profile.sources[0].transport).toBe('http');
  });

  it('rejects a source with duplicated ids', () => {
    expect(() =>
      ProfileSchema.parse({
        name: 'test',
        llm: { provider: 'claude-agent-sdk' },
        sources: [
          { id: 'a', name: 'A', transport: 'stdio', command: 'echo', args: [] },
          { id: 'a', name: 'B', transport: 'stdio', command: 'echo', args: [] },
        ],
      })
    ).toThrow(/duplicate.+id/i);
  });

  it('rejects an unknown transport', () => {
    expect(() =>
      ProfileSchema.parse({
        name: 'test',
        llm: { provider: 'claude-agent-sdk' },
        sources: [{ id: 'x', name: 'X', transport: 'carrier-pigeon' }],
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test config
```

Expected: FAIL — `sources` is not a known property; the duplicate-id refinement test fails (no validation logic yet).

- [ ] **Step 3: Extend `src/config/schema.ts`**

Read the current schema. Insert before `ProfileSchema`:

```typescript
export const SourceConfigSchema = z.discriminatedUnion('transport', [
  z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/, 'id must be kebab/snake-case ASCII'),
    name: z.string(),
    transport: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}),
  }),
  z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/),
    name: z.string(),
    transport: z.literal('sse'),
    url: z.string().url(),
    headers: z.record(z.string()).default({}),
  }),
  z.object({
    id: z.string().regex(/^[a-z0-9_-]+$/),
    name: z.string(),
    transport: z.literal('http'),
    url: z.string().url(),
    headers: z.record(z.string()).default({}),
  }),
]);

export type SourceConfig = z.infer<typeof SourceConfigSchema>;
```

Then add `sources: ...` to `ProfileSchema`. Also add the `superRefine` that enforces unique ids:

```typescript
export const ProfileSchema = z.object({
  // ... existing name, llm, embed fields ...
  sources: z
    .array(SourceConfigSchema)
    .default([])
    .superRefine((sources, ctx) => {
      const seen = new Set<string>();
      for (const s of sources) {
        if (seen.has(s.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate source id: ${s.id}`,
            path: [sources.findIndex((x) => x.id === s.id), 'id'],
          });
        }
        seen.add(s.id);
      }
    }),
});
```

(Leave the existing `name`, `llm`, `embed` fields exactly as they were — only add `sources`.)

- [ ] **Step 4: Update `DEFAULT_CONFIG` in `src/config/loader.ts`**

Find the default config object and add `sources: []` to the default profile:

```typescript
{
  name: 'claude-sdk',
  llm: { provider: 'claude-agent-sdk' },
  embed: { provider: 'onnx-bundled', model: 'BAAI/bge-small-en-v1.5' },
  sources: [],
}
```

- [ ] **Step 5: Run config tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test config
```

Expected: all tests pass (existing 50+ plus the 5 new `Profile.sources` tests).

- [ ] **Step 6: Run all tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test
```

Expected: all passing. Typecheck:

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/config/schema.ts src/config/loader.ts __tests__/config.test.ts
git commit -m "feat(config): SourceConfig discriminated union (stdio/sse/http)"
```

---

## Task 3: MCP transport — connect to a configured server

**Files:**
- Create: `src/mcp/transport.ts`

Wraps the official MCP SDK's `Client` + transport classes. Returns a connected `Client` that tasks 4 and 5 use. We isolate the SDK touch point here so the rest of the codebase only depends on our wrapper.

- [ ] **Step 1: Implement the transport wrapper**

Create `src/mcp/transport.ts`:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { SourceConfig } from '../config/schema.js';

const CLIENT_NAME = 'llm-wiki';
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
```

If the SDK's exported paths differ (subpaths can shift between major versions), adapt the imports to match. Keep the public function signature (`createMcpClient(config): Promise<Client>`) the same.

- [ ] **Step 2: Verify typecheck**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0. If imports are wrong, fix them now.

- [ ] **Step 3: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/mcp/transport.ts
git commit -m "feat(mcp): createMcpClient — stdio/sse/http transport"
```

---

## Task 4: MCPSource — wraps a Client into a typed Source

**Files:**
- Create: `src/mcp/source.ts`

- [ ] **Step 1: Write the unit test**

Append to `__tests__/mcp.test.ts`:

```typescript
import { MCPSource } from '../src/mcp/source.js';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

class FakeClient {
  // Just enough surface for MCPSource to call.
  async listTools() {
    return {
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object' as const, properties: {} },
        },
      ],
    };
  }
  async callTool(args: { name: string; arguments?: unknown }) {
    return { content: [{ type: 'text' as const, text: `called ${args.name}` }] };
  }
  async close() {}
}

describe('MCPSource', () => {
  it('introspects tools via listTools()', async () => {
    const source = new MCPSource('fs', 'Filesystem', new FakeClient() as unknown as Client);
    const result = await source.introspect();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('read_file');
    expect(source.health).toBe('connected');
  });

  it('callTool delegates to the underlying client', async () => {
    const source = new MCPSource('fs', 'Filesystem', new FakeClient() as unknown as Client);
    const out = await source.callTool('read_file', { path: '/etc/hostname' });
    expect(out).toBeDefined();
  });

  it('marks source disconnected after close()', async () => {
    const source = new MCPSource('fs', 'Filesystem', new FakeClient() as unknown as Client);
    await source.close();
    expect(source.health).toBe('disconnected');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test mcp
```

Expected: FAIL — `MCPSource` not exported.

- [ ] **Step 3: Implement `MCPSource`**

Create `src/mcp/source.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test mcp
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/mcp/source.ts __tests__/mcp.test.ts
git commit -m "feat(mcp): MCPSource — introspect, callTool, close"
```

---

## Task 5: SourceRegistry — manages connected sources

**Files:**
- Create: `src/mcp/registry.ts`

Connects all configured sources from a Profile, exposes them by id, and ensures clean shutdown. CLI commands (Task 6) consume this registry.

- [ ] **Step 1: Write the unit test**

Append to `__tests__/mcp.test.ts`:

```typescript
import { SourceRegistry } from '../src/mcp/registry.js';

describe('SourceRegistry', () => {
  it('starts empty', () => {
    const r = new SourceRegistry();
    expect(r.list()).toEqual([]);
  });

  it('add() / get() / list() / remove()', () => {
    const r = new SourceRegistry();
    const fakeSource = new MCPSource('fs', 'FS', new FakeClient() as unknown as Client);
    r.add(fakeSource);
    expect(r.list()).toHaveLength(1);
    expect(r.get('fs')).toBe(fakeSource);
    r.remove('fs');
    expect(r.list()).toEqual([]);
  });

  it('add() rejects duplicate ids', () => {
    const r = new SourceRegistry();
    r.add(new MCPSource('fs', 'FS', new FakeClient() as unknown as Client));
    expect(() =>
      r.add(new MCPSource('fs', 'Other', new FakeClient() as unknown as Client))
    ).toThrow(/already registered/);
  });

  it('closeAll() closes every registered source', async () => {
    const r = new SourceRegistry();
    const a = new MCPSource('a', 'A', new FakeClient() as unknown as Client);
    const b = new MCPSource('b', 'B', new FakeClient() as unknown as Client);
    r.add(a);
    r.add(b);
    await r.closeAll();
    expect(a.health).toBe('disconnected');
    expect(b.health).toBe('disconnected');
    expect(r.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test mcp
```

Expected: FAIL — `SourceRegistry` not exported.

- [ ] **Step 3: Implement `SourceRegistry`**

Create `src/mcp/registry.ts`:

```typescript
import type { MCPSource } from './source.js';
import { createMcpClient } from './transport.js';
import type { SourceConfig } from '../config/schema.js';
import { MCPSource as MCPSourceImpl } from './source.js';

export class SourceRegistry {
  private readonly sources = new Map<string, MCPSource>();

  add(source: MCPSource): void {
    if (this.sources.has(source.id)) {
      throw new Error(`Source already registered: ${source.id}`);
    }
    this.sources.set(source.id, source);
  }

  get(id: string): MCPSource | undefined {
    return this.sources.get(id);
  }

  list(): MCPSource[] {
    return Array.from(this.sources.values());
  }

  remove(id: string): void {
    this.sources.delete(id);
  }

  /**
   * Connect every configured source in `configs`. Sources that fail to
   * connect are skipped with a degraded entry; we never throw at the
   * top level so the CLI can still report partial state.
   */
  async connectAll(
    configs: SourceConfig[]
  ): Promise<{ ok: MCPSource[]; failed: { config: SourceConfig; error: string }[] }> {
    const ok: MCPSource[] = [];
    const failed: { config: SourceConfig; error: string }[] = [];

    for (const config of configs) {
      try {
        const client = await createMcpClient(config);
        const source = new MCPSourceImpl(config.id, config.name, client);
        await source.introspect();
        this.add(source);
        ok.push(source);
      } catch (e) {
        failed.push({
          config,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return { ok, failed };
  }

  async closeAll(): Promise<void> {
    const all = this.list();
    this.sources.clear();
    await Promise.allSettled(all.map((s) => s.close()));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test mcp
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/mcp/registry.ts __tests__/mcp.test.ts
git commit -m "feat(mcp): SourceRegistry — add/get/list/remove + connectAll/closeAll"
```

---

## Task 6: CLI commands — list, probe, list-tools, call-tool

**Files:**
- Modify: `src/cli.ts`

Add four new commands:

| Command | Behavior |
| --- | --- |
| `pnpm cli --list-sources` | Lists configured sources from the active profile (id, name, transport). |
| `pnpm cli --probe-sources` | Connects every configured source, prints health + tool count. |
| `pnpm cli --list-tools <source-id>` | Connects to one source, prints its tool catalog. |
| `pnpm cli --call-tool <source-id> <tool-name> [json-args]` | Connects to one source and calls a single tool. Prints the result. |

- [ ] **Step 1: Read the existing CLI structure**

Read `src/cli.ts` to see how Plan 1 added `--probe`, `--list-profiles`, `--embed`, `--storage-status`. Mirror that style.

- [ ] **Step 2: Add the four branches**

Insert near the existing `--probe` / `--list-profiles` / `--embed` branches in `src/cli.ts`:

```typescript
if (args.includes('--list-sources')) {
  const { activeProfile } = await loadConfig({ profileOverride });
  if (activeProfile.sources.length === 0) {
    console.log('No sources configured for profile:', activeProfile.name);
    console.log("Add sources to ~/.llm-wiki/config.json under profiles[].sources.");
    return;
  }
  console.log(`Sources for profile '${activeProfile.name}':`);
  for (const s of activeProfile.sources) {
    const detail =
      s.transport === 'stdio'
        ? `${s.command} ${s.args.join(' ')}`
        : s.url;
    console.log(`  - ${s.id.padEnd(20)} (${s.transport})  ${s.name}  ${detail}`);
  }
  return;
}

if (args.includes('--probe-sources')) {
  const { activeProfile } = await loadConfig({ profileOverride });
  const { SourceRegistry } = await import('./mcp/registry.js');
  const registry = new SourceRegistry();
  const { ok, failed } = await registry.connectAll(activeProfile.sources);

  for (const s of ok) {
    console.log(`[OK]   ${s.id.padEnd(20)} ${s.name}  tools=${s.tools.length}`);
  }
  for (const f of failed) {
    console.log(`[FAIL] ${f.config.id.padEnd(20)} ${f.config.name}  ${f.error}`);
  }

  await registry.closeAll();
  return;
}

if (args.includes('--list-tools')) {
  const idx = args.indexOf('--list-tools');
  const sourceId = args[idx + 1];
  if (!sourceId) {
    console.error('Usage: pnpm cli --list-tools <source-id>');
    process.exit(1);
  }
  const { activeProfile } = await loadConfig({ profileOverride });
  const config = activeProfile.sources.find((s) => s.id === sourceId);
  if (!config) {
    console.error(`No source with id '${sourceId}' in profile '${activeProfile.name}'.`);
    process.exit(1);
  }
  const { createMcpClient } = await import('./mcp/transport.js');
  const { MCPSource } = await import('./mcp/source.js');
  const client = await createMcpClient(config);
  const source = new MCPSource(config.id, config.name, client);
  await source.introspect();
  console.log(`Tools for ${source.name} (${source.tools.length}):`);
  for (const t of source.tools) {
    console.log(`  - ${t.name.padEnd(28)} ${t.description ?? ''}`);
  }
  await source.close();
  return;
}

if (args.includes('--call-tool')) {
  const idx = args.indexOf('--call-tool');
  const sourceId = args[idx + 1];
  const toolName = args[idx + 2];
  const argsJson = args[idx + 3] ?? '{}';
  if (!sourceId || !toolName) {
    console.error('Usage: pnpm cli --call-tool <source-id> <tool-name> [json-args]');
    process.exit(1);
  }
  let toolArgs: unknown;
  try {
    toolArgs = JSON.parse(argsJson);
  } catch (e) {
    console.error('Invalid JSON args:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  const { activeProfile } = await loadConfig({ profileOverride });
  const config = activeProfile.sources.find((s) => s.id === sourceId);
  if (!config) {
    console.error(`No source with id '${sourceId}' in profile '${activeProfile.name}'.`);
    process.exit(1);
  }
  const { createMcpClient } = await import('./mcp/transport.js');
  const { MCPSource } = await import('./mcp/source.js');
  const client = await createMcpClient(config);
  const source = new MCPSource(config.id, config.name, client);
  try {
    const result = await source.callTool(toolName, toolArgs);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await source.close();
  }
  return;
}
```

- [ ] **Step 3: Verify typecheck**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm typecheck
```

Expected: exit 0.

- [ ] **Step 4: Smoke-test `--list-sources` (no real source needed)**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm cli --list-sources
```

Expected: prints "No sources configured for profile: claude-sdk" (assuming the default config still has no sources).

- [ ] **Step 5: Run all tests**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add src/cli.ts
git commit -m "feat(cli): --list-sources, --probe-sources, --list-tools, --call-tool"
```

---

## Task 7: Integration test — filesystem MCP server

**Files:**
- Create: `__tests__/mcp-fs.integration.test.ts`

Spawns `@modelcontextprotocol/server-filesystem` against a temp directory and verifies the full wire: `createMcpClient` → `listTools` → `callTool`. Skipped by default; run with `RUN_INTEGRATION=1`.

- [ ] **Step 1: Create the integration test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpClient } from '../src/mcp/transport.js';
import { MCPSource } from '../src/mcp/source.js';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('MCP integration — filesystem server', () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'llm-wiki-mcp-test-'));
    writeFileSync(join(fixtureDir, 'hello.txt'), 'Hello from the fixture\n');
  });

  afterAll(() => {
    if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
  });

  it(
    'connects, lists tools, and calls read_file',
    async () => {
      const client = await createMcpClient({
        id: 'fs',
        name: 'Filesystem',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', fixtureDir],
        env: {},
      });

      const source = new MCPSource('fs', 'Filesystem', client);
      await source.introspect();

      // Filesystem server exposes at minimum: read_file, write_file, list_directory
      const toolNames = source.tools.map((t) => t.name);
      expect(toolNames).toEqual(expect.arrayContaining(['read_file', 'list_directory']));

      const result = (await source.callTool('read_file', {
        path: join(fixtureDir, 'hello.txt'),
      })) as { content: { type: string; text?: string }[] };

      const text = result.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');
      expect(text).toContain('Hello from the fixture');

      await source.close();
    },
    30_000
  );
});
```

- [ ] **Step 2: Run unit tests (integration is skipped by default)**

```bash
cd /Users/krunal/Development/llm-wiki && pnpm test
```

Expected: PASS, integration test reported as skipped.

- [ ] **Step 3: Run the integration test (one-time validation)**

```bash
cd /Users/krunal/Development/llm-wiki && RUN_INTEGRATION=1 pnpm test mcp-fs
```

Expected: PASS within ~10–20 seconds. First run downloads `@modelcontextprotocol/server-filesystem` via `npx -y`, subsequent runs are fast.

If the integration test fails:
- **`spawn npx ENOENT`:** the npx binary isn't on PATH. Hardcode `which npx` output in the test or fall back to a global install.
- **Tool name mismatch:** the filesystem server may expose tools under different names (e.g. `fs_read_file` instead of `read_file`). Update the assertion to match what the server actually returns. Document the actual tool names.
- **Server shutdown timeout:** the test's `source.close()` may hang. Add an explicit timeout to `client.close()` or document the server's shutdown behaviour.

- [ ] **Step 4: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add __tests__/mcp-fs.integration.test.ts
git commit -m "test(mcp): integration with @modelcontextprotocol/server-filesystem"
```

---

## Task 8: README — MCP section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a MCP / Sources section**

Read the current `README.md`. Append (after the Storage / Embedders sections from Plan 1):

```markdown
## MCP Sources

Configure MCP servers in `~/.llm-wiki/config.json` under `profiles[].sources`. Three transports are supported: `stdio` (subprocess), `sse` (Server-Sent Events), and `http` (Streamable HTTP).

### Example: filesystem MCP

\`\`\`jsonc
{
  "activeProfile": "claude-sdk",
  "profiles": [
    {
      "name": "claude-sdk",
      "llm": { "provider": "claude-agent-sdk" },
      "embed": { "provider": "onnx-bundled", "model": "BAAI/bge-small-en-v1.5" },
      "sources": [
        {
          "id": "workspace-fs",
          "name": "Workspace Files",
          "transport": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me/code"]
        }
      ]
    }
  ]
}
\`\`\`

### CLI commands

\`\`\`bash
# List configured sources for the active profile
pnpm cli --list-sources

# Connect every source and print health + tool count
pnpm cli --probe-sources

# Print the tool catalog for one source
pnpm cli --list-tools workspace-fs

# Call a tool directly
pnpm cli --call-tool workspace-fs read_file '{"path": "/Users/me/code/README.md"}'
\`\`\`

### Roadmap

- v2 (this plan): connect/list/call. Raw tool surface.
- v3 (Plan 3): typed `Capability` verbs (`search` / `fetch` / `list` / `subscribe`) mapped onto MCP tools, with optional `source-manifest.json` hints.
- v3+ (Plan 5): MCP results materialised as typed `Result<K>` and routed through the agent loop.
```

(Replace escaped backticks with real triple-backticks in the actual README.)

- [ ] **Step 2: Commit**

```bash
cd /Users/krunal/Development/llm-wiki
git add README.md
git commit -m "docs: MCP sources configuration and CLI commands"
```

---

## Spec coverage check

| Spec section / amendment | Implemented in |
| --- | --- |
| §3 — `Source` type | Task 1 |
| §3 — `ResultKind` literal-union enum | Task 1 |
| §5 — Three MCP transport variants (stdio/sse/http) | Task 2 (config), Task 3 (transport) |
| §5 — Source registry with introspection | Tasks 4, 5 |
| §5 — Profile config exposing configured sources | Task 2 |
| §5 — CLI tooling for sources (list, probe, query) | Task 6 |
| §5 — Integration validated against a real MCP server | Task 7 |

**Out of scope (deferred — already enumerated in plan header):**
- `Capability` verb mapping (Plan 3)
- Typed `Result<K>` (Plan 3 / Plan 5)
- Cross-source link resolver (Plan 3)
- MCP wired into space-agent's chat surface (Plan 1.6)
- Subscribe / streaming for ELK / k8s (Plan 3)
- Manifest hints for non-standard MCP servers (Plan 3)

All Plan 2 deliverables traced.

---

## Verification before declaring complete

- [ ] All tests pass: `pnpm test` exits 0 (50+ from Plan 1, plus ~10–12 new MCP unit tests; integration skipped by default)
- [ ] Typecheck passes: `pnpm typecheck` exits 0
- [ ] `pnpm cli --list-sources` runs (prints "No sources configured" for the default profile)
- [ ] `pnpm cli --probe-sources` runs without crashing on an empty source list
- [ ] One-time: `RUN_INTEGRATION=1 pnpm test mcp-fs` passes, validating the full stdio wire with the filesystem MCP server
- [ ] `git log --oneline` shows ~8 new commits since the start of Plan 2
- [ ] No `node_modules` or `*.sqlite` or `vendor/space-agent/` files committed

---

*End of Plan 2.*

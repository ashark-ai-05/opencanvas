import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpClient } from '../src/mcp/transport.js';
import { MCPSource } from '../src/mcp/source.js';

const runIntegration = process.env.RUN_INTEGRATION === '1';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('MCP integration — filesystem server', () => {
  let fixtureDir: string;

  beforeAll(() => {
    // Use realpathSync to resolve macOS /var -> /private/var symlink so the
    // path we pass to the server and the path we use to read match exactly.
    fixtureDir = realpathSync(mkdtempSync(join(tmpdir(), 'opencanvas-mcp-test-')));
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

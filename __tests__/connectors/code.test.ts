import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeConnector } from '../../src/connectors/code.js';

describe('CodeConnector', () => {
  it('walks source files in sorted order, yielding RawDocuments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'strata-code-'));
    try {
      await writeFile(join(root, 'a.ts'), 'export const a = 1;\n');
      await mkdir(join(root, 'sub'));
      await writeFile(join(root, 'sub', 'b.ts'), 'export const b = 2;\n');
      await writeFile(join(root, 'sub', 'c.md'), '# heading\nbody\n');
      // Skip directories should be ignored.
      await mkdir(join(root, 'node_modules'));
      await writeFile(join(root, 'node_modules', 'noise.ts'), 'noise');

      const connector = new CodeConnector({
        project: 'demo',
        rootPath: root,
      });
      const docs: { uri: string; kind: string; sourceId: string }[] = [];
      const gen = connector.run({});
      while (true) {
        const next = await gen.next();
        if (next.done) break;
        docs.push({
          uri: next.value.uri,
          kind: next.value.kind,
          sourceId: next.value.sourceId,
        });
      }
      const uris = docs.map((d) => d.uri.replace(root, ''));
      expect(uris).toEqual(['/a.ts', '/sub/b.ts', '/sub/c.md']);
      expect(docs.every((d) => d.sourceId === 'code:demo')).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cursor advances and re-running with the cursor yields nothing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'strata-code-'));
    try {
      await writeFile(join(root, 'a.ts'), 'a');
      await writeFile(join(root, 'b.ts'), 'b');

      const c = new CodeConnector({ project: 'demo', rootPath: root });
      const first: string[] = [];
      let firstResult: { cursorAfter?: string } | undefined;
      const gen1 = c.run({});
      while (true) {
        const n = await gen1.next();
        if (n.done) {
          firstResult = n.value;
          break;
        }
        first.push(n.value.uri);
      }
      expect(first.length).toBe(2);
      expect(firstResult?.cursorAfter).toBeDefined();

      const second: string[] = [];
      const gen2 = c.run({ since: firstResult?.cursorAfter });
      while (true) {
        const n = await gen2.next();
        if (n.done) break;
        second.push(n.value.uri);
      }
      expect(second).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

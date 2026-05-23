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

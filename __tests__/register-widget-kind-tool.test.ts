import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { WidgetRegistry } from '../src/backend/widget-registry.js';
import { registerWidgetKindTool } from '../src/agent/tools/register-widget-kind.js';

// Inline the same kind regex used by the tool so we can test it directly.
// The SDK's tool() wrapper applies Zod validation at the MCP protocol layer,
// not when .handler() is called directly — so we test the schema separately.
const kindSchema = z.string().regex(/^[a-z][a-z0-9-]{2,30}$/);

/**
 * The tool factory wraps a handler via the Claude Agent SDK's `tool()` helper.
 * The SDK stores the handler as `.handler` on the returned object, which is
 * what we call directly in these tests.
 */
function makeTool() {
  const registry = new WidgetRegistry();
  const toolDef = registerWidgetKindTool(() => registry);
  return { registry, handler: toolDef.handler.bind(toolDef) };
}

describe('register_widget_kind tool', () => {
  let registry: WidgetRegistry;
  let handler: ReturnType<typeof makeTool>['handler'];

  beforeEach(() => {
    ({ registry, handler } = makeTool());
  });

  it('registers a new kind and the registry contains it', async () => {
    const result = await handler(
      {
        kind: 'stock-ticker',
        label: 'Stock Ticker',
        description: 'Shows real-time stock prices for a given symbol. Pass {symbol: string}.',
        srcdoc: '<!doctype html><html><body>Hello</body></html>',
      },
      {},
    );
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(true);
    expect(registry.get('stock-ticker')).toBeDefined();
    expect(registry.get('stock-ticker')!.label).toBe('Stock Ticker');
  });

  it('rejects duplicate kinds', async () => {
    registry.register({
      kind: 'foo',
      label: 'F',
      description: 'd',
      renderer: { type: 'iframe', srcdoc: 'x' },
    });
    const result = await handler(
      {
        kind: 'foo',
        label: 'Foo2',
        description: 'a different one but same kind name aaaaaaaaaaaa',
        srcdoc: '<!doctype html><html><body>Hi</body></html>',
      },
      {},
    );
    expect(result.isError).toBe(true);
    const data = JSON.parse(result.content[0].text);
    expect(data.ok).toBe(false);
    expect(data.error).toMatch(/already exists/i);
  });

  it('uses default_size {420,280} when not specified', async () => {
    await handler(
      {
        kind: 'weather',
        label: 'Weather',
        description: 'Weather card for a given location. Pass {city: string}.',
        srcdoc: '<!doctype html><html><body>weather here</body></html>',
      },
      {},
    );
    expect(registry.get('weather')!.renderer.defaultSize).toEqual({ w: 420, h: 280 });
  });

  it('honors custom default_size', async () => {
    await handler(
      {
        kind: 'big-card',
        label: 'Big',
        description: 'A larger custom card. Pass {body: string}.',
        srcdoc: '<!doctype html><html><body>big</body></html>',
        default_size: { w: 800, h: 600 },
      },
      {},
    );
    expect(registry.get('big-card')!.renderer.defaultSize).toEqual({ w: 800, h: 600 });
  });

  it('stores correct renderer type and sandbox', async () => {
    await handler(
      {
        kind: 'my-widget',
        label: 'My Widget',
        description: 'A custom widget. Pass {data: object}.',
        srcdoc: '<!doctype html><html><body>custom</body></html>',
      },
      {},
    );
    const desc = registry.get('my-widget')!;
    expect(desc.renderer.type).toBe('iframe');
    expect(desc.renderer.sandbox).toBe('allow-scripts');
    expect(desc.renderer.srcdoc).toContain('custom');
  });

  it('stores description on the registered descriptor', async () => {
    await handler(
      {
        kind: 'info-card',
        label: 'Info Card',
        description: 'Shows info for an entity. Pass {title: string, body: string}.',
        srcdoc: '<!doctype html><html><body>info</body></html>',
      },
      {},
    );
    const desc = registry.get('info-card')!;
    expect(desc.description).toMatch(/Pass \{title/);
  });

  it('rejects invalid kind names via Zod schema (uppercase, special chars, too short)', () => {
    // The SDK's tool() wrapper applies Zod validation at the MCP protocol
    // layer, not when .handler() is called directly in unit tests. We test
    // the same regex used in the inputShape directly.
    const badKinds = ['Stock-Ticker', 'foo.bar', 'foo bar', 'ab', '_underscore'];
    for (const bad of badKinds) {
      expect(
        kindSchema.safeParse(bad).success,
        `expected "${bad}" to be rejected by kind regex`,
      ).toBe(false);
    }
  });

  it('accepts valid kind names via Zod schema', () => {
    const goodKinds = ['stock-ticker', 'weather-card', 'abc', 'my-widget-123'];
    for (const good of goodKinds) {
      expect(
        kindSchema.safeParse(good).success,
        `expected "${good}" to be accepted by kind regex`,
      ).toBe(true);
    }
  });
});

import { describe, it, expect } from 'vitest';
import { placeWidgetTool } from '../../../src/agent/tools/place-widget.js';

describe('place_widget', () => {
  it('returns ok=true with a generated id and a place directive', async () => {
    const handler = placeWidgetTool().handler;
    const r = await handler(
      {
        kind: 'markdown',
        role: 'primary',
        payload: { title: 'auth', body: 'overview' },
      },
      undefined,
    );
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.ok).toBe(true);
    expect(typeof out.id).toBe('string');
    expect(out.id.length).toBeGreaterThan(0);
    expect(out.directive).toEqual({
      type: 'place',
      id: out.id,
      kind: 'markdown',
      role: 'primary',
      payload: { title: 'auth', body: 'overview' },
    });
  });

  it('auto-classifies a malformed specialized payload to generic', async () => {
    const handler = placeWidgetTool().handler;
    const r = await handler(
      {
        kind: 'web-embed',
        role: 'reference',
        // Missing required `url`; web-embed schema will reject.
        payload: { title: 'docs', body: 'fallback markdown' },
      },
      undefined,
    );
    expect(r.isError).toBeFalsy();
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.ok).toBe(true);
    expect(out.directive.kind).toBe('generic');
    expect(out.reformatted).toEqual(
      expect.objectContaining({ from: 'web-embed' }),
    );
    // The classifier should have salvaged the body field as a markdown block.
    expect(out.directive.payload.blocks).toContainEqual(
      expect.objectContaining({ type: 'markdown' }),
    );
  });

  it('auto-classifies an unknown kind to generic', async () => {
    const handler = placeWidgetTool().handler;
    const r = await handler(
      {
        kind: 'candlestick-chart',
        role: 'primary',
        payload: { title: 'BTC', columns: [{ key: 't' }], rows: [['09:00']] },
      },
      undefined,
    );
    expect(r.isError).toBeFalsy();
    const out = JSON.parse(r.content[0]!.text!);
    expect(out.directive.kind).toBe('generic');
    expect(out.reformatted).toEqual(
      expect.objectContaining({ from: 'candlestick-chart' }),
    );
  });

  it('mints a unique id per call', async () => {
    const handler = placeWidgetTool().handler;
    const a = JSON.parse(
      (await handler(
        { kind: 'markdown', role: 'primary', payload: { title: 't', body: 'b' } },
        undefined,
      )).content[0]!.text!,
    );
    const b = JSON.parse(
      (await handler(
        { kind: 'markdown', role: 'primary', payload: { title: 't', body: 'b' } },
        undefined,
      )).content[0]!.text!,
    );
    expect(a.id).not.toBe(b.id);
  });

  describe('plugin kind hints in tool description', () => {
    it('omits the plugin section when no plugins are registered', () => {
      const tool = placeWidgetTool();
      expect(tool.description).not.toMatch(/Plugin widget kinds/);
    });

    it('appends a plugin section listing registered kinds', () => {
      const tool = placeWidgetTool([
        {
          kind: 'chart',
          label: 'Chart',
          description: 'Vega-Lite spec renderer',
        },
        {
          kind: 'yearly-calendar',
          description: 'A 12-month grid with year nav',
        },
      ]);
      expect(tool.description).toMatch(/Plugin widget kinds/);
      expect(tool.description).toMatch(/- chart \(Chart\) — Vega-Lite spec renderer/);
      expect(tool.description).toMatch(/- yearly-calendar — A 12-month grid with year nav/);
    });

    it('sorts plugins alphabetically for stable prompt content', () => {
      const tool = placeWidgetTool([
        { kind: 'zebra' },
        { kind: 'alpha' },
        { kind: 'mango' },
      ]);
      const idxAlpha = tool.description!.indexOf('- alpha');
      const idxMango = tool.description!.indexOf('- mango');
      const idxZebra = tool.description!.indexOf('- zebra');
      expect(idxAlpha).toBeGreaterThan(0);
      expect(idxAlpha).toBeLessThan(idxMango);
      expect(idxMango).toBeLessThan(idxZebra);
    });
  });
});

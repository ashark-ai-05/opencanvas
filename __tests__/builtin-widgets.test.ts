import { describe, it, expect } from 'vitest';
import { WidgetRegistry } from '../src/backend/widget-registry.js';
import { registerBuiltinWidgets } from '../src/backend/builtin-widgets.js';

describe('built-in widgets', () => {
  it('registers chart and calendar plugins on init', () => {
    const reg = new WidgetRegistry();
    registerBuiltinWidgets(reg);
    const all = reg.list();
    const kinds = all.map((d) => d.kind).sort();
    expect(kinds).toContain('chart');
    expect(kinds).toContain('calendar');
  });

  it('calendar plugin has expected shape', () => {
    const reg = new WidgetRegistry();
    registerBuiltinWidgets(reg);
    const cal = reg.get('calendar');
    expect(cal).toBeDefined();
    expect(cal!.label).toBeTruthy();
    expect(cal!.description).toMatch(/calendar/i);
    expect(cal!.renderer.type).toBe('iframe');
    expect(cal!.renderer.srcdoc).toContain('opencanvas:props');
    expect(cal!.renderer.srcdoc).toMatch(/year|month/i);
    expect(cal!.renderer.defaultSize).toEqual({ w: 540, h: 420 });
  });

  it('calendar srcdoc is pure vanilla JS with no external scripts', () => {
    const reg = new WidgetRegistry();
    registerBuiltinWidgets(reg);
    const cal = reg.get('calendar');
    const srcdoc = cal!.renderer.srcdoc;
    // Must not pull any external CDN resources (pure vanilla JS requirement)
    expect(srcdoc).not.toMatch(/cdn\.|jsdelivr|unpkg|googleapis/i);
    // Must have doctype and head style
    expect(srcdoc).toContain('<!doctype html>');
    expect(srcdoc).toContain('<style>');
  });

  it('calendar srcdoc handles opencanvas:props event for updates', () => {
    const reg = new WidgetRegistry();
    registerBuiltinWidgets(reg);
    const cal = reg.get('calendar');
    const srcdoc = cal!.renderer.srcdoc;
    expect(srcdoc).toContain("'opencanvas:props'");
    expect(srcdoc).toContain('window.opencanvas');
  });

  it('calendar srcdoc supports both year and month view', () => {
    const reg = new WidgetRegistry();
    registerBuiltinWidgets(reg);
    const cal = reg.get('calendar');
    const srcdoc = cal!.renderer.srcdoc;
    expect(srcdoc).toContain('year');
    expect(srcdoc).toContain('month');
    // year-grid and month-view CSS classes should be present
    expect(srcdoc).toContain('year-grid');
    expect(srcdoc).toContain('month-view');
  });

  it('chart plugin has expected shape', () => {
    const reg = new WidgetRegistry();
    registerBuiltinWidgets(reg);
    const chart = reg.get('chart');
    expect(chart).toBeDefined();
    expect(chart!.label).toBe('Chart');
    expect(chart!.renderer.type).toBe('iframe');
    expect(chart!.renderer.defaultSize).toEqual({ w: 520, h: 360 });
  });

  it('registry list returns both builtins sorted', () => {
    const reg = new WidgetRegistry();
    registerBuiltinWidgets(reg);
    const kinds = reg.list().map((d) => d.kind);
    // sorted alphabetically: calendar < chart
    expect(kinds.indexOf('calendar')).toBeLessThan(kinds.indexOf('chart'));
  });

  it('registers html plugin alongside chart + calendar', () => {
    const reg = new WidgetRegistry();
    registerBuiltinWidgets(reg);
    expect(reg.get('html')).toBeDefined();
    expect(reg.get('html')!.renderer.srcdoc).toContain('opencanvas:props');
  });

  it('html plugin has expected shape', () => {
    const reg = new WidgetRegistry();
    registerBuiltinWidgets(reg);
    const html = reg.get('html');
    expect(html).toBeDefined();
    expect(html!.label).toBe('HTML');
    expect(html!.renderer.type).toBe('iframe');
    expect(html!.renderer.sandbox).toBe('allow-scripts');
    expect(html!.renderer.defaultSize).toEqual({ w: 480, h: 320 });
  });

  it('html srcdoc uses nested iframe for sandboxing (no innerHTML with user content)', () => {
    const reg = new WidgetRegistry();
    registerBuiltinWidgets(reg);
    const srcdoc = reg.get('html')!.renderer.srcdoc;
    // Must use a nested iframe with sandbox attribute for user HTML
    expect(srcdoc).toContain('allow-scripts');
    expect(srcdoc).toContain('srcdoc');
    // Must have doctype and style block
    expect(srcdoc).toContain('<!doctype html>');
    expect(srcdoc).toContain('<style>');
    // Must listen for live prop updates
    expect(srcdoc).toContain("'opencanvas:props'");
    expect(srcdoc).toContain('window.opencanvas');
  });

  it('html srcdoc shows empty state when no html prop', () => {
    const reg = new WidgetRegistry();
    registerBuiltinWidgets(reg);
    const srcdoc = reg.get('html')!.renderer.srcdoc;
    // Empty state message
    expect(srcdoc).toContain('html');
    expect(srcdoc).toContain('empty');
  });
});

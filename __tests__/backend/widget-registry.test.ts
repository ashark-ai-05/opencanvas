import { describe, it, expect, vi } from 'vitest';
import { WidgetRegistry } from '../../src/backend/widget-registry.js';

describe('WidgetRegistry', () => {
  it('register stores the descriptor + emits a register event', () => {
    const reg = new WidgetRegistry();
    const events: unknown[] = [];
    reg.subscribe((e) => events.push(e));
    const stored = reg.register({
      kind: 'candlestick',
      label: 'Candlestick chart',
      renderer: { type: 'iframe', srcdoc: '<p>hi</p>' },
    });
    expect(stored.kind).toBe('candlestick');
    expect(reg.has('candlestick')).toBe(true);
    expect(events).toHaveLength(1);
  });

  it('register applies sandbox default when omitted', () => {
    const reg = new WidgetRegistry();
    const stored = reg.register({
      kind: 'k',
      renderer: { type: 'iframe', srcdoc: '<p>x</p>' },
    });
    expect(stored.renderer.type).toBe('iframe');
    if (stored.renderer.type === 'iframe') {
      expect(stored.renderer.sandbox).toBe('allow-scripts');
    }
  });

  it('register replaces an existing kind (hot update)', () => {
    const reg = new WidgetRegistry();
    reg.register({ kind: 'k', renderer: { type: 'iframe', srcdoc: 'a' } });
    reg.register({ kind: 'k', renderer: { type: 'iframe', srcdoc: 'b' } });
    const got = reg.get('k');
    expect(got?.renderer.type).toBe('iframe');
    if (got?.renderer.type === 'iframe') {
      expect(got.renderer.srcdoc).toBe('b');
    }
  });

  it('unregister removes + emits an unregister event', () => {
    const reg = new WidgetRegistry();
    reg.register({ kind: 'k', renderer: { type: 'iframe', srcdoc: 'x' } });
    const events: unknown[] = [];
    reg.subscribe((e) => events.push(e));
    expect(reg.unregister('k')).toBe(true);
    expect(reg.has('k')).toBe(false);
    expect(reg.unregister('k')).toBe(false);
    expect(events).toHaveLength(1);
  });

  it('list returns descriptors sorted by kind', () => {
    const reg = new WidgetRegistry();
    reg.register({ kind: 'beta', renderer: { type: 'iframe', srcdoc: '' } });
    reg.register({ kind: 'alpha', renderer: { type: 'iframe', srcdoc: '' } });
    expect(reg.list().map((d) => d.kind)).toEqual(['alpha', 'beta']);
  });

  it('listener errors do not break other subscribers', () => {
    const reg = new WidgetRegistry();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls: string[] = [];
    reg.subscribe(() => {
      throw new Error('boom');
    });
    reg.subscribe(() => calls.push('ok'));
    reg.register({ kind: 'k', renderer: { type: 'iframe', srcdoc: '' } });
    expect(calls).toEqual(['ok']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('unsubscribe stops further events', () => {
    const reg = new WidgetRegistry();
    let count = 0;
    const unsub = reg.subscribe(() => {
      count += 1;
    });
    reg.register({ kind: 'k', renderer: { type: 'iframe', srcdoc: '' } });
    unsub();
    reg.unregister('k');
    expect(count).toBe(1);
  });
});

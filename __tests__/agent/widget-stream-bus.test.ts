import { describe, it, expect } from 'vitest';
import { WidgetStreamBus } from '../../src/agent/widget-stream-bus.js';

async function drain<T>(iter: AsyncIterable<T>, ms = 100): Promise<T[]> {
  const out: T[] = [];
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, ms));
  const reader = (async () => {
    for await (const item of iter) out.push(item);
  })();
  await Promise.race([reader, timeout]);
  return out;
}

describe('WidgetStreamBus', () => {
  it('emits start/op/end in order with monotonic seq', async () => {
    const bus = new WidgetStreamBus();
    const events: unknown[] = [];
    const reader = (async () => {
      for await (const e of bus) events.push(e);
    })();

    bus.start({ id: 'w1', widgetKind: 'generic', role: 'primary', scaffold: { title: 't', blocks: [] } });
    bus.op('w1', { kind: 'append-text', blockIndex: 0, text: 'a' });
    bus.op('w1', { kind: 'append-text', blockIndex: 0, text: 'b' });
    bus.end('w1', true);
    bus.close();

    await reader;

    expect(events).toEqual([
      { kind: 'start', id: 'w1', widgetKind: 'generic', role: 'primary', scaffold: { title: 't', blocks: [] } },
      { kind: 'op', id: 'w1', seq: 1, op: { kind: 'append-text', blockIndex: 0, text: 'a' } },
      { kind: 'op', id: 'w1', seq: 2, op: { kind: 'append-text', blockIndex: 0, text: 'b' } },
      { kind: 'end', id: 'w1', ok: true },
    ]);
  });

  it('isIdle is false between start and end, true otherwise', () => {
    const bus = new WidgetStreamBus();
    expect(bus.isIdle()).toBe(true);
    bus.start({ id: 'a', widgetKind: 'generic', role: 'primary', scaffold: {} });
    expect(bus.isIdle()).toBe(false);
    bus.end('a', true);
    expect(bus.isIdle()).toBe(true);
  });

  it('cancels are sticky and queryable per id', () => {
    const bus = new WidgetStreamBus();
    bus.start({ id: 'x', widgetKind: 'generic', role: 'primary', scaffold: {} });
    expect(bus.isCancelled('x')).toBe(false);
    bus.cancel('x');
    expect(bus.isCancelled('x')).toBe(true);
  });

  it('writes after close are dropped silently', async () => {
    const bus = new WidgetStreamBus();
    bus.close();
    bus.op('x', { kind: 'append-text', blockIndex: 0, text: 'late' });
    bus.end('x', true);
    const events = await drain(bus, 50);
    expect(events).toEqual([]);
  });

  it('interleaves events from multiple concurrent streams', async () => {
    const bus = new WidgetStreamBus();
    bus.start({ id: 'a', widgetKind: 'generic', role: 'primary', scaffold: {} });
    bus.start({ id: 'b', widgetKind: 'generic', role: 'detail', scaffold: {} });
    bus.op('a', { kind: 'append-text', blockIndex: 0, text: 'a1' });
    bus.op('b', { kind: 'append-text', blockIndex: 0, text: 'b1' });
    bus.op('a', { kind: 'append-text', blockIndex: 0, text: 'a2' });
    bus.end('a', true);
    bus.end('b', true);
    bus.close();
    const events = await drain(bus, 100);
    const ids = events.map((e: { id: string }) => e.id);
    expect(ids).toEqual(['a', 'b', 'a', 'b', 'a', 'a', 'b']);
    // Each id has its own monotonic seq
    const aOps = events.filter((e: { id: string; kind: string }) => e.id === 'a' && e.kind === 'op');
    expect((aOps as Array<{ seq: number }>).map((e) => e.seq)).toEqual([1, 2]);
    const bOps = events.filter((e: { id: string; kind: string }) => e.id === 'b' && e.kind === 'op');
    expect((bOps as Array<{ seq: number }>).map((e) => e.seq)).toEqual([1]);
  });
});

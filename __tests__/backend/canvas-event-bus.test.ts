import { describe, it, expect } from 'vitest';
import { CanvasEventBus } from '../../src/backend/canvas-event-bus.js';

describe('CanvasEventBus', () => {
  it('queues events when there are no waiters and delivers on subscribe', async () => {
    const bus = new CanvasEventBus();
    const sub = bus.subscribe();
    bus.push({ directive: { type: 'clear' } });
    bus.push({ directive: { type: 'focus', id: 'w-1' } });

    const it1 = sub[Symbol.asyncIterator]();
    const a = await it1.next();
    const b = await it1.next();
    expect(a.value.directive.type).toBe('clear');
    expect(b.value.directive.type).toBe('focus');
    sub.close();
  });

  it('fans out to multiple subscribers', async () => {
    const bus = new CanvasEventBus();
    const subA = bus.subscribe();
    const subB = bus.subscribe();
    bus.push({ directive: { type: 'clear' } });

    const itA = subA[Symbol.asyncIterator]();
    const itB = subB[Symbol.asyncIterator]();
    const [a, b] = await Promise.all([itA.next(), itB.next()]);
    expect(a.value.directive.type).toBe('clear');
    expect(b.value.directive.type).toBe('clear');

    subA.close();
    subB.close();
  });

  it('drops events for closed subscribers without affecting others', async () => {
    const bus = new CanvasEventBus();
    const subA = bus.subscribe();
    const subB = bus.subscribe();
    subA.close();
    bus.push({ directive: { type: 'clear' } });

    expect(bus.subscriberCount()).toBe(1);
    const itB = subB[Symbol.asyncIterator]();
    const r = await itB.next();
    expect(r.value.directive.type).toBe('clear');
    subB.close();
  });

  it('resolves a pending waiter when an event arrives', async () => {
    const bus = new CanvasEventBus();
    const sub = bus.subscribe();
    const it = sub[Symbol.asyncIterator]();
    const pending = it.next();
    setTimeout(() => bus.push({ directive: { type: 'clear' } }), 10);
    const r = await pending;
    expect(r.value.directive.type).toBe('clear');
    sub.close();
  });

  it('iterator return() unsubscribes the listener', async () => {
    const bus = new CanvasEventBus();
    const sub = bus.subscribe();
    expect(bus.subscriberCount()).toBe(1);
    const it = sub[Symbol.asyncIterator]();
    await it.return?.();
    expect(bus.subscriberCount()).toBe(0);
  });
});

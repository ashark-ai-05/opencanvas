import type { ToolDirective } from '../agent/types.js';

/**
 * Per-conversation pipe carrying ToolDirective objects from external
 * REST callers (POST /v1/canvas/widgets, etc.) out to the browser via
 * a long-lived SSE connection.
 *
 * Differences vs WidgetStreamBus:
 *   - Persistent across requests (not closed at end of chat turn).
 *   - Multi-subscriber via fan-out: two browser tabs on the same
 *     conversation both see external pushes.
 *   - Carries any ToolDirective (place / update / focus / clear /
 *     remove / link / switchTemplate / stream-{start,op,end}) rather
 *     than only stream events.
 *
 * Flow:
 *   external POST → state.getCanvasEventBus(convId).push(directive)
 *                ↘ each subscribed SSE handler resolves with the event
 *                ↘ browser dispatcher applies it to tldraw
 */
export type CanvasBusEvent = { directive: ToolDirective };

/**
 * Single subscriber's read interface — an async iterator that yields
 * events in arrival order. Closing the iterator (return()) unsubscribes
 * the listener so the bus stops queueing for it.
 */
export interface CanvasBusSubscription extends AsyncIterable<CanvasBusEvent> {
  close(): void;
}

export class CanvasEventBus {
  /**
   * Each subscriber owns an independent queue + waiter. Fan-out push:
   * iterate every subscriber, drop the event into their slot.
   */
  private subscribers: Subscriber[] = [];

  push(event: CanvasBusEvent): void {
    for (const sub of this.subscribers) sub.write(event);
  }

  subscribe(): CanvasBusSubscription {
    const sub = new Subscriber(() => {
      this.subscribers = this.subscribers.filter((s) => s !== sub);
    });
    this.subscribers.push(sub);
    return sub;
  }

  /** Number of currently-open subscribers. Useful for diagnostics. */
  subscriberCount(): number {
    return this.subscribers.length;
  }
}

class Subscriber implements CanvasBusSubscription {
  private queue: CanvasBusEvent[] = [];
  private waiters: Array<(value: IteratorResult<CanvasBusEvent>) => void> = [];
  private closed = false;

  constructor(private readonly onClose: () => void) {}

  write(event: CanvasBusEvent): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) {
      w({ value: event, done: false });
      return;
    }
    this.queue.push(event);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose();
    while (this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      w({ value: undefined as unknown as CanvasBusEvent, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<CanvasBusEvent> {
    return {
      next: (): Promise<IteratorResult<CanvasBusEvent>> => {
        if (this.queue.length > 0) {
          const value = this.queue.shift()!;
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({
            value: undefined as unknown as CanvasBusEvent,
            done: true,
          });
        }
        return new Promise((resolve) => {
          this.waiters.push(resolve);
        });
      },
      return: (): Promise<IteratorResult<CanvasBusEvent>> => {
        this.close();
        return Promise.resolve({
          value: undefined as unknown as CanvasBusEvent,
          done: true,
        });
      },
    };
  }
}

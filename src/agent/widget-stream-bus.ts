import type { WidgetStreamOp, WidgetKind, Role } from './types.js';

/**
 * Per-turn pipe carrying widget-streaming events from tool handlers
 * (running inside the in-process MCP) out to the chat route's SSE
 * writer. The bus is created per chat turn in chat.ts, passed into
 * `buildAgentTools` via deps, and drained in parallel with the
 * provider event stream.
 *
 * Wire format (matches the data-* parts the UI peels):
 *   { kind: 'start', id, widgetKind, role, scaffold }
 *   { kind: 'op',    id, seq, op }
 *   { kind: 'end',   id, ok, error? }
 *
 * The bus is intentionally minimal: an internal queue + an async
 * iterator. No pub/sub, no replay — the chat route is the ONLY
 * consumer per turn.
 */

export type WidgetStreamEvent =
  | {
      kind: 'start';
      id: string;
      widgetKind: WidgetKind;
      role: Role;
      scaffold: Record<string, unknown>;
    }
  | { kind: 'op'; id: string; seq: number; op: WidgetStreamOp }
  | { kind: 'end'; id: string; ok: boolean; error?: string };

export class WidgetStreamBus {
  /** Pending events not yet pulled by the chat-route drain loop. */
  private queue: WidgetStreamEvent[] = [];
  /** Resolvers waiting for the next event when the queue is empty. */
  private waiters: Array<(value: IteratorResult<WidgetStreamEvent>) => void> = [];
  /**
   * IDs of widgets the agent has explicitly cancelled (POST
   * /v1/cancel-stream/:id). Tool handlers should poll this between
   * ops and stop early when their id appears.
   */
  private cancelled = new Set<string>();
  /**
   * Whether the bus has been closed by the chat-route owner. Once
   * closed, write() is a no-op (a late writer can't crash the route)
   * and the iterator yields done. Tool handlers that race with the
   * provider stream finishing won't deadlock the route.
   */
  private closed = false;
  /** Open stream ids — tracked so the chat route can wait for drain. */
  private open = new Set<string>();
  /** Per-id sequence counter so the tool doesn't have to thread one. */
  private seqs = new Map<string, number>();

  /** Emit a stream-start event. Returns the id for chaining. */
  start(args: {
    id: string;
    widgetKind: WidgetKind;
    role: Role;
    scaffold: Record<string, unknown>;
  }): string {
    if (this.closed) return args.id;
    this.open.add(args.id);
    this.seqs.set(args.id, 0);
    this.write({
      kind: 'start',
      id: args.id,
      widgetKind: args.widgetKind,
      role: args.role,
      scaffold: args.scaffold,
    });
    return args.id;
  }

  /** Emit a stream-op event with auto-incremented sequence. */
  op(id: string, op: WidgetStreamOp): void {
    if (this.closed) return;
    const seq = (this.seqs.get(id) ?? 0) + 1;
    this.seqs.set(id, seq);
    this.write({ kind: 'op', id, seq, op });
  }

  /** Emit a stream-end event and stop tracking the id. */
  end(id: string, ok: boolean, error?: string): void {
    if (this.closed) return;
    this.open.delete(id);
    this.seqs.delete(id);
    const event: WidgetStreamEvent = { kind: 'end', id, ok };
    if (error) event.error = error;
    this.write(event);
  }

  /** Mark a stream as cancelled. Tool handlers should poll `isCancelled`. */
  cancel(id: string): void {
    this.cancelled.add(id);
  }
  isCancelled(id: string): boolean {
    return this.cancelled.has(id);
  }

  /** True when all opened streams have been ended. */
  isIdle(): boolean {
    return this.open.size === 0;
  }

  /**
   * Close the bus. Subsequent writes are dropped silently; the
   * iterator returns done after draining whatever is queued. The
   * chat route calls this after the provider stream ends AND all
   * open streams have ended (or the abort signal fires).
   */
  close(): void {
    this.closed = true;
    while (this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      w({ value: undefined as unknown as WidgetStreamEvent, done: true });
    }
  }

  /**
   * Async iterator the chat route consumes alongside provider events.
   * Yields each event as soon as it lands; blocks when the queue is
   * empty until either a new event arrives or the bus is closed.
   */
  [Symbol.asyncIterator](): AsyncIterator<WidgetStreamEvent> {
    return {
      next: (): Promise<IteratorResult<WidgetStreamEvent>> => {
        if (this.queue.length > 0) {
          const value = this.queue.shift()!;
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          return Promise.resolve({
            value: undefined as unknown as WidgetStreamEvent,
            done: true,
          });
        }
        return new Promise<IteratorResult<WidgetStreamEvent>>((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }

  private write(event: WidgetStreamEvent): void {
    const w = this.waiters.shift();
    if (w) {
      w({ value: event, done: false });
      return;
    }
    this.queue.push(event);
  }
}

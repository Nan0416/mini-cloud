import { LoggerFactory } from './logger';

const logger = LoggerFactory.getLogger('AsyncQueue');

/**
 * Serialises async handling of a stream of events.
 *
 * Instance status updates arrive concurrently from agents and must be applied one at
 * a time: two handlers running in parallel would each read the current status,
 * compare ranks against the same stale value, and both write — letting an older
 * status clobber a newer one. Funnelling them through this queue makes
 * read-compare-write atomic without touching the database's isolation level.
 */
export class AsyncQueue<T> {
  private readonly buffer: T[] = [];
  private processing = false;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly handler: (event: T) => Promise<void>) {}

  /** Fire-and-forget. Events are handled in enqueue order. */
  enqueue(event: T): void {
    this.buffer.push(event);
    if (!this.processing) {
      void this.drainLoop();
    }
  }

  get size(): number {
    return this.buffer.length;
  }

  /** Resolves once the queue has emptied. Used on shutdown so nothing is dropped. */
  async drain(): Promise<void> {
    if (!this.processing && this.buffer.length === 0) {
      return;
    }
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private async drainLoop(): Promise<void> {
    this.processing = true;
    while (this.buffer.length > 0) {
      const event = this.buffer.shift();
      if (event === undefined) {
        continue;
      }
      try {
        await this.handler(event);
      } catch (err) {
        // A failed event must not stall the queue behind it.
        logger.error('Queued event handler threw.', err);
      }
    }
    this.processing = false;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) {
      resolve();
    }
  }
}

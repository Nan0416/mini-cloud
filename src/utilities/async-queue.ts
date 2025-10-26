import { LoggerFactory } from '@sparrow/logging-js';

export interface AsyncQueueProps {
  readonly name?: string;
  readonly maxSize?: number;
  readonly throwErrorOnTermination?: boolean;
  readonly continueOnError?: boolean;
}

/**
 * The async queue has two purposes
 * 1. It alleviates the node.js internal buffer by allowing the event source to cache data into an array.
 * 2. It guarantees events are processed one at a time and in order.
 */
const logger = LoggerFactory.getLogger('AsyncQueue');

interface StandardError {
  readonly _source: string;
  readonly code: string;
  readonly message: string;
  readonly statusCode?: number;
}

export class AsyncQueue<T> {
  private readonly events: T[];
  /**
   * -1 indicates infinite.
   * 0 indicates close the queue.
   */
  private _maxSize: number;
  private _onEvent?: (event: T) => Promise<void>;
  private _onError?: (event: T, err: any) => void;
  private _state: 'running' | 'waiting';
  private _terminated: boolean;
  private readonly logMeta: any | undefined;
  private readonly throwErrorOnTermination: boolean;
  private readonly continueOnError: boolean;

  private _workingPromise?: Promise<void>;

  constructor(props?: AsyncQueueProps) {
    this.events = [];
    this._maxSize = typeof props?.maxSize === 'number' ? props.maxSize : -1;
    this._state = 'waiting';
    this._terminated = false;
    this.throwErrorOnTermination = props?.throwErrorOnTermination ?? false;
    this.continueOnError = props?.continueOnError ?? false;
    if (typeof props?.name === 'string') {
      this.logMeta = { queueName: props.name };
    }
  }

  enqueue(event: T) {
    if (this._terminated) {
      const message = 'enqueue task while the async queue is terminated';
      logger.warn(message, this.logMeta);
      if (this.throwErrorOnTermination) {
        throw this.error(message, 'EnqueueOnTermination');
      }
      return;
    }

    this.events.push(event);

    if (this._maxSize > 0) {
      if (this.events.length > this._maxSize) {
        logger.warn(`current async task ${this.events.length} length exceeds the maximum allowed length ${this._maxSize}`, this.logMeta);
      }
      while (this.events.length > this._maxSize) {
        this.events.shift();
      }
    }

    setImmediate(() => this.run());
  }

  set onEvent(handler: (event: T) => Promise<void>) {
    this._onEvent = handler;
  }

  set onError(handler: (event: T, err: any) => void) {
    this._onError = handler;
  }

  async terminate() {
    // terminate
    this._terminated = true;

    this.run();

    if (this._workingPromise !== undefined) {
      await this._workingPromise;
    }
  }

  private run() {
    if (this._state === 'running') {
      return;
    }

    this._state = 'running';

    logger.debug('refresh working promise', this.logMeta);

    this._workingPromise = new Promise((resolve, reject) => {
      this.runTasks(resolve);
    });
  }

  private async runTasks(resolve: () => void) {
    while (this.events.length > 0) {
      const event = this.events.shift()!;
      if (this._onEvent) {
        try {
          await this._onEvent(event);
        } catch (err: any) {
          logger.warn('encounter event processing failure', this.logMeta);
          this._onError ? this._onError(event, err) : 0;
          if (!this.continueOnError) {
            break;
          }
        }
      }
    }

    logger.debug('resolve working promise', this.logMeta);
    resolve();
    this._state = 'waiting';
  }

  private error(message: string, code: string): StandardError {
    return {
      _source: 'AsyncQueue',
      code: code,
      message: message,
      statusCode: 400,
    };
  }
}

import { EventEnvelope, HubMessage, LinearBackoff, LoggerFactory, SubscriberRequest } from '@mini-cloud/shared';
import { WebSocket } from 'ws';

const logger = LoggerFactory.getLogger('WsSubscriber');

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'closed';

export interface WsSubscriberProps {
  /** e.g. `ws://127.0.0.1:3000/ws` */
  readonly url: string;
  readonly token?: string;
  readonly onEvent?: (envelope: EventEnvelope) => void;
  readonly onStateChange?: (state: ConnectionState) => void;
}

/**
 * A subscriber that survives the service restarting.
 *
 * Topic subscriptions are held locally and replayed after every reconnect, so a
 * caller subscribes once and stops thinking about the connection. This is a single
 * class rather than a stateless socket plus a stateful wrapper: the two layers only
 * ever appeared together, and splitting them made the reconnect path hard to follow.
 */
export class WsSubscriber {
  private readonly props: WsSubscriberProps;
  private readonly topics = new Set<string>();
  private readonly backoff = new LinearBackoff(200, 10_000, 500);

  private socket?: WebSocket;
  private state: ConnectionState = 'disconnected';
  private subscriberId?: string;
  private closedByCaller = false;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(props: WsSubscriberProps) {
    this.props = props;
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  /** Resolves once the first connection is established. */
  async connect(): Promise<void> {
    if (this.closedByCaller) {
      throw new Error('This subscriber has been closed and cannot reconnect.');
    }
    await this.openSocket();
  }

  async subscribe(topic: string): Promise<void> {
    this.topics.add(topic);
    if (this.state === 'connected') {
      this.send({ action: 'subscribe', topic });
    }
  }

  async unsubscribe(topic: string): Promise<void> {
    this.topics.delete(topic);
    if (this.state === 'connected') {
      this.send({ action: 'unsubscribe', topic });
    }
  }

  async publish(topic: string, payload: unknown): Promise<void> {
    if (this.state !== 'connected') {
      throw new Error(`Cannot publish to ${topic}: the subscriber is ${this.state}.`);
    }
    this.send({ action: 'publish', topic, payload });
  }

  async close(): Promise<void> {
    this.closedByCaller = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket?.close(1000, 'Client closing');
    this.socket = undefined;
    this.setState('closed');
  }

  private openSocket(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.setState('connecting');
      const headers = this.props.token === undefined ? undefined : { authorization: `Bearer ${this.props.token}` };
      const socket = new WebSocket(this.props.url, { headers });
      this.socket = socket;

      let settled = false;
      const settle = (err?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        if (err === undefined) {
          resolve();
        } else {
          reject(err);
        }
      };

      socket.on('open', () => {
        logger.info(`Connected to ${this.props.url}.`);
        this.setState('connected');
        this.backoff.reset();
        // Replay every subscription: to the service this is a brand-new connection
        // with a new subscriber id and no memory of what we were listening to.
        for (const topic of this.topics) {
          this.send({ action: 'subscribe', topic });
        }
        settle();
      });

      socket.on('message', (data) => this.onMessage(data.toString()));

      socket.on('error', (err) => {
        logger.warn(`Socket error: ${err.message}`);
        // Only fail connect() if we never got up; later errors are handled by
        // reconnecting, and rejecting here would surface as an unhandled rejection.
        settle(err);
      });

      socket.on('close', (code, reason) => {
        this.setState('disconnected');
        this.subscriberId = undefined;
        if (this.closedByCaller) {
          return;
        }
        logger.warn(`Disconnected (${code} ${reason.toString()}); reconnecting.`);
        settle(new Error(`WebSocket closed before it opened (${code}).`));
        this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.closedByCaller || this.reconnectTimer !== undefined) {
      return;
    }
    const delay = this.backoff.nextDelayMs();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket().catch(() => {
        // openSocket's own close handler schedules the next attempt, so a failure
        // here needs no action beyond not crashing the process.
      });
    }, delay);
  }

  private onMessage(raw: string): void {
    let message: HubMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      logger.warn('Ignoring a message from the hub that is not valid JSON.');
      return;
    }

    switch (message.type) {
      case 'welcome':
        this.subscriberId = message.subscriberId;
        logger.debug(`Hub assigned subscriber id ${message.subscriberId}.`);
        return;
      case 'event':
        this.props.onEvent?.(message.envelope);
        return;
      case 'ack':
        logger.debug(`Hub acknowledged ${message.action} ${message.topic}.`);
        return;
      case 'error':
        logger.warn(`Hub reported an error: ${message.message}`);
        return;
    }
  }

  private send(request: SubscriberRequest): void {
    this.socket?.send(JSON.stringify(request), (err) => {
      if (err !== undefined && err !== null) {
        logger.warn(`Failed to send ${request.action} for ${request.topic}.`, err);
      }
    });
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) {
      return;
    }
    this.state = state;
    this.props.onStateChange?.(state);
  }

  get id(): string | undefined {
    return this.subscriberId;
  }
}

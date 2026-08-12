import { EventEnvelope, HubMessage, HubStatus, LoggerFactory, SUBSCRIBER_ACTIONS, SubscriberAction, SubscriberRequest, assertOneOf, assertString } from '@mini-cloud/shared';
import { IncomingMessage, Server } from 'http';
import { nanoid } from 'nanoid';
import { WebSocket, WebSocketServer } from 'ws';
import { MessageHub } from './message-hub';

const logger = LoggerFactory.getLogger('WsMessageHub');

const HEARTBEAT_INTERVAL_MS = 30_000;

interface Subscriber {
  readonly id: string;
  readonly socket: WebSocket;
  readonly topics: Set<string>;
  alive: boolean;
}

type VerifyClient = (info: { req: IncomingMessage }, done: (result: boolean, code?: number, message?: string) => void) => void;

/**
 * Rejects the upgrade before a socket exists when a token is configured and the
 * request does not carry it. Returns undefined when no token is set, so `ws` skips
 * verification entirely rather than running a check that always passes.
 */
function buildVerifyClient(authToken: string | undefined): VerifyClient | undefined {
  if (authToken === undefined) {
    return undefined;
  }
  return (info, done) => {
    if (info.req.headers.authorization === `Bearer ${authToken}`) {
      done(true);
      return;
    }
    logger.warn('Rejected a WebSocket upgrade: missing or invalid bearer token.');
    done(false, 401, 'Unauthorized');
  };
}

export interface WsMessageHubProps {
  /** The service's HTTP server. Sharing it keeps mini-cloud on a single port. */
  readonly server: Server;
  readonly path?: string;
  /**
   * Bearer token required on the upgrade request.
   *
   * Checked here rather than in Express middleware: a WebSocket upgrade never
   * reaches the middleware stack, so without this the socket would be an
   * unauthenticated way in while the HTTP API was locked down.
   */
  readonly authToken?: string;
}

/**
 * A topic-based fan-out hub over WebSockets.
 *
 * Keeps two indexes — subscriber to topics, and topic to subscribers — so both
 * publishing to a topic and cleaning up a dropped connection are O(subscriptions)
 * rather than a scan of every connection.
 */
export class WsMessageHub implements MessageHub {
  private readonly wss: WebSocketServer;
  private readonly subscribers = new Map<string, Subscriber>();
  private readonly topicToSubscriberIds = new Map<string, Set<string>>();
  private readonly heartbeat: NodeJS.Timeout;
  private terminating = false;

  constructor(props: WsMessageHubProps) {
    this.wss = new WebSocketServer({
      server: props.server,
      path: props.path ?? '/ws',
      verifyClient: buildVerifyClient(props.authToken),
    });
    this.wss.on('connection', (socket) => this.onConnection(socket));

    // A dropped connection (laptop sleeping, cable pulled) does not always produce a
    // close event. Ping/pong is what actually reclaims those subscriptions.
    this.heartbeat = setInterval(() => this.sweepDeadConnections(), HEARTBEAT_INTERVAL_MS);
  }

  private onConnection(socket: WebSocket): void {
    if (this.terminating) {
      socket.close(1001, 'Server shutting down');
      return;
    }

    const subscriber: Subscriber = { id: nanoid(12), socket, topics: new Set(), alive: true };
    this.subscribers.set(subscriber.id, subscriber);
    logger.info(`Subscriber ${subscriber.id} connected (${this.subscribers.size} total).`);

    socket.on('pong', () => {
      subscriber.alive = true;
    });
    socket.on('message', (data) => this.onMessage(subscriber, data.toString()));
    socket.on('close', (code, reason) => {
      logger.info(`Subscriber ${subscriber.id} disconnected (${code} ${reason.toString()}).`);
      this.removeSubscriber(subscriber.id);
    });
    socket.on('error', (err) => {
      logger.warn(`Subscriber ${subscriber.id} socket errored.`, err);
    });

    this.send(subscriber, { type: 'welcome', subscriberId: subscriber.id });
  }

  private onMessage(subscriber: Subscriber, raw: string): void {
    if (this.terminating) {
      return;
    }

    let request: SubscriberRequest;
    try {
      request = this.parseRequest(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Malformed request';
      logger.warn(`Rejected request from subscriber ${subscriber.id}: ${message}`);
      this.send(subscriber, { type: 'error', message });
      return;
    }

    switch (request.action) {
      case 'subscribe':
        this.subscribe(subscriber, request.topic);
        this.send(subscriber, { type: 'ack', action: 'subscribe', topic: request.topic });
        return;
      case 'unsubscribe':
        this.unsubscribe(subscriber, request.topic);
        this.send(subscriber, { type: 'ack', action: 'unsubscribe', topic: request.topic });
        return;
      case 'publish':
        this.publish(request.topic, request.payload, subscriber.id);
        this.send(subscriber, { type: 'ack', action: 'publish', topic: request.topic });
        return;
      case 'ping':
        subscriber.alive = true;
        this.send(subscriber, { type: 'ack', action: 'ping', topic: '' });
        return;
    }
  }

  private parseRequest(raw: string): SubscriberRequest {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('Request is not valid JSON');
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Request must be an object');
    }
    const record: Record<string, unknown> = { ...parsed };
    const action: SubscriberAction = assertOneOf(record['action'], 'action', SUBSCRIBER_ACTIONS);
    // `ping` carries no topic; everything else is meaningless without one.
    const topic = action === 'ping' ? '' : assertString(record['topic'], 'topic');
    return { action, topic, payload: record['payload'] };
  }

  publish(topic: string, payload: unknown, senderId?: string): number {
    const subscriberIds = this.topicToSubscriberIds.get(topic);
    if (subscriberIds === undefined || subscriberIds.size === 0) {
      logger.debug(`No subscribers on topic ${topic}; dropping message.`);
      return 0;
    }

    const now = Date.now();
    let delivered = 0;
    for (const subscriberId of subscriberIds) {
      const subscriber = this.subscribers.get(subscriberId);
      if (subscriber === undefined || subscriber.socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      const envelope: EventEnvelope = { topic, payload, publishedAt: now, forwardedAt: now, senderId };
      this.send(subscriber, { type: 'event', envelope });
      delivered += 1;
    }

    logger.debug(`Published to topic ${topic}; delivered to ${delivered} subscriber(s).`);
    return delivered;
  }

  getStatus(): HubStatus {
    const topicToSubscriberCount: Record<string, number> = {};
    for (const [topic, subscriberIds] of this.topicToSubscriberIds) {
      topicToSubscriberCount[topic] = subscriberIds.size;
    }
    return { subscriberCount: this.subscribers.size, topicToSubscriberCount };
  }

  async terminate(): Promise<void> {
    logger.info('Terminating message hub.');
    this.terminating = true;
    clearInterval(this.heartbeat);
    for (const subscriber of this.subscribers.values()) {
      subscriber.socket.close(1001, 'Server shutting down');
    }
    this.subscribers.clear();
    this.topicToSubscriberIds.clear();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    logger.info('Message hub terminated.');
  }

  private subscribe(subscriber: Subscriber, topic: string): void {
    subscriber.topics.add(topic);
    let subscriberIds = this.topicToSubscriberIds.get(topic);
    if (subscriberIds === undefined) {
      subscriberIds = new Set();
      this.topicToSubscriberIds.set(topic, subscriberIds);
    }
    subscriberIds.add(subscriber.id);
    logger.info(`Subscriber ${subscriber.id} subscribed to ${topic}.`);
  }

  private unsubscribe(subscriber: Subscriber, topic: string): void {
    subscriber.topics.delete(topic);
    const subscriberIds = this.topicToSubscriberIds.get(topic);
    if (subscriberIds !== undefined) {
      subscriberIds.delete(subscriber.id);
      if (subscriberIds.size === 0) {
        this.topicToSubscriberIds.delete(topic);
      }
    }
    logger.info(`Subscriber ${subscriber.id} unsubscribed from ${topic}.`);
  }

  private removeSubscriber(subscriberId: string): void {
    const subscriber = this.subscribers.get(subscriberId);
    if (subscriber === undefined) {
      return;
    }
    // Walk only this subscriber's own topics rather than every topic in the hub.
    for (const topic of subscriber.topics) {
      const subscriberIds = this.topicToSubscriberIds.get(topic);
      if (subscriberIds !== undefined) {
        subscriberIds.delete(subscriberId);
        if (subscriberIds.size === 0) {
          this.topicToSubscriberIds.delete(topic);
        }
      }
    }
    this.subscribers.delete(subscriberId);
  }

  private sweepDeadConnections(): void {
    for (const subscriber of this.subscribers.values()) {
      if (!subscriber.alive) {
        logger.warn(`Subscriber ${subscriber.id} missed a heartbeat; closing.`);
        subscriber.socket.terminate();
        this.removeSubscriber(subscriber.id);
        continue;
      }
      subscriber.alive = false;
      subscriber.socket.ping();
    }
  }

  private send(subscriber: Subscriber, message: HubMessage): void {
    if (subscriber.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    subscriber.socket.send(JSON.stringify(message), (err) => {
      if (err !== undefined && err !== null) {
        logger.warn(`Failed to send to subscriber ${subscriber.id}.`, err);
      }
    });
  }
}

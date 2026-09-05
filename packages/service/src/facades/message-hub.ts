import {
  EventEnvelope,
  HubMessage,
  HubStatus,
  LoggerFactory,
  SUBSCRIBER_ACTIONS,
  SubscriberAction,
  SubscriberRequest,
  Target,
  assertDefined,
  assertInteger,
  assertNonEmptyString,
  assertOneOf,
} from '@mini-cloud/shared';
import { IncomingMessage, Server } from 'node:http';
import { nanoid } from 'nanoid';
import { WebSocket, WebSocketServer } from 'ws';
import { describeUntrustedAddress, isTrustedAddress, parseSubnets } from '../utils/subnet';

const logger = LoggerFactory.getLogger('WsMessageHub');

/**
 * What a publisher supplies. The hub adds `forwardedAt` and the target to build the
 * `EventEnvelope` it delivers.
 */
export interface OutboundMessage {
  readonly payload: unknown;
  /** Epoch ms the publisher stamped the message, before it crossed the network. */
  readonly publishedAt: number;
  /**
   * Subscriber id of the sender, taken from the sending connection. Left unset for
   * HTTP publishers, which hold no connection and publish anonymously. Never read
   * from a request body — see `EventEnvelope.senderId`.
   */
  readonly senderId?: string;
}

export interface MessageHub {
  /**
   * Delivers `message` to `target` — every subscriber of a topic, or the one
   * subscriber named by a p2p target. Returns how many received it.
   *
   * Callers inside the service use this directly rather than going through HTTP —
   * the hub is a component of the service, not a separate deployable.
   */
  publish(target: Target, message: OutboundMessage): number;

  getStatus(): HubStatus;

  terminate(): Promise<void>;
}

const HEARTBEAT_INTERVAL_MS = 30_000;

interface Subscriber {
  readonly id: string;
  readonly socket: WebSocket;
  readonly topics: Set<string>;
  alive: boolean;
}

type VerifyClient = (info: { req: IncomingMessage }, done: (result: boolean, code?: number, message?: string) => void) => void;

/**
 * Rejects an upgrade from outside the trusted subnets, before a socket exists.
 *
 * This duplicates what `subnetFilter` does for ordinary requests, and it has to: an
 * upgrade never reaches the express middleware stack, so the filter guarding the rest
 * of the internal listener does not see it. Since the source address is now the only
 * thing guarding that listener, a hub without this check is an unguarded way in — and
 * the hub is the channel agents take their launch commands from, so reaching it is
 * enough to run a command on every machine in the fleet.
 *
 * Returns undefined when no subnets are configured, so `ws` skips verification
 * entirely rather than running a check that always passes.
 */
function buildVerifyClient(trustedSubnets: ReadonlyArray<string>): VerifyClient | undefined {
  const subnets = parseSubnets(trustedSubnets);
  if (subnets.length === 0) {
    return undefined;
  }

  return (info, done) => {
    // From the socket, never from `X-Forwarded-For`: a header the caller writes is
    // not evidence of where the caller is.
    const address = info.req.socket.remoteAddress;
    if (isTrustedAddress(address, subnets)) {
      done(true);
      return;
    }
    logger.warn(`Rejected a WebSocket upgrade from ${address ?? 'an unknown address'}: outside the trusted subnets.`);
    done(false, 403, describeUntrustedAddress(address, subnets));
  };
}

export interface WsMessageHubProps {
  /**
   * The HTTP server to attach to — the *internal* one.
   *
   * A WebSocket shares the listening port of the server it is attached to, so this
   * choice is what decides which port `/ws` answers on — and it is the whole of what
   * keeps the hub off the public listener. Nothing there claims the upgrade, so it
   * falls through to that listener's 404, which names this one.
   */
  readonly server: Server;
  readonly path?: string;
  /** CIDR blocks an upgrade may come from. Empty accepts any address. */
  readonly trustedSubnets?: ReadonlyArray<string>;
}

/**
 * A fan-out hub over WebSockets, addressing messages either to a topic or to a
 * single subscriber.
 *
 * Keeps two indexes — subscriber to topics, and topic to subscribers — so both
 * broadcasting to a topic and cleaning up a dropped connection are O(subscriptions)
 * rather than a scan of every connection. P2P needs neither index: a subscriber id
 * is already the key of the connection map, so a directed send is a single lookup.
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
      verifyClient: buildVerifyClient(props.trustedSubnets ?? []),
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

    // The id is announced rather than kept server-side: it is the address other
    // subscribers send p2p messages to, so a subscriber that cannot learn its own id
    // can be talked about but never talked to.
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
        this.send(subscriber, { type: 'ack', action: 'subscribe', to: request.topic });
        return;
      case 'unsubscribe':
        this.unsubscribe(subscriber, request.topic);
        this.send(subscriber, { type: 'ack', action: 'unsubscribe', to: request.topic });
        return;
      case 'broadcast':
        this.publishFromSubscriber(subscriber, { method: 'broadcast', to: request.topic }, request.publishedAt, request.payload);
        return;
      case 'p2p':
        this.publishFromSubscriber(subscriber, { method: 'p2p', to: request.recipientId }, request.publishedAt, request.payload);
        return;
      case 'ping':
        subscriber.alive = true;
        this.send(subscriber, { type: 'ack', action: 'ping', to: '' });
        return;
    }
  }

  /**
   * Publishes on behalf of a connected subscriber, stamping the sender from the
   * connection the frame arrived on rather than from anything in the frame — the
   * only reason a recipient can trust `senderId` enough to reply to it.
   */
  private publishFromSubscriber(subscriber: Subscriber, target: Target, publishedAt: number, payload: unknown): void {
    logger.info(`Subscriber ${subscriber.id} sends a ${target.method} message to ${target.to}.`);
    const deliveredTo = this.publish(target, { payload, publishedAt, senderId: subscriber.id });
    this.send(subscriber, { type: 'ack', action: target.method, to: target.to, deliveredTo });
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

    switch (action) {
      case 'ping':
        // Carries no address and no payload; it exists only to keep the socket warm.
        return { action };
      case 'subscribe':
      case 'unsubscribe':
        return { action, topic: assertNonEmptyString(record['topic'], 'topic') };
      case 'broadcast':
        return {
          action,
          topic: assertNonEmptyString(record['topic'], 'topic'),
          publishedAt: assertInteger(record['publishedAt'], 'publishedAt'),
          payload: assertDefined(record['payload'], 'payload'),
        };
      case 'p2p':
        return {
          action,
          recipientId: assertNonEmptyString(record['recipientId'], 'recipientId'),
          publishedAt: assertInteger(record['publishedAt'], 'publishedAt'),
          payload: assertDefined(record['payload'], 'payload'),
        };
    }
  }

  publish(target: Target, message: OutboundMessage): number {
    const recipients = this.recipientsOf(target);
    if (recipients.length === 0) {
      // A p2p miss is worth a warning — the sender named someone specific and got
      // nobody — while an empty topic is the ordinary state of an idle hub.
      if (target.method === 'p2p') {
        logger.warn(`Recipient ${target.to} is not connected; dropping the message.`);
      } else {
        logger.debug(`No subscribers on topic ${target.to}; dropping message.`);
      }
      return 0;
    }

    const envelope: EventEnvelope = {
      target,
      payload: message.payload,
      publishedAt: message.publishedAt,
      forwardedAt: Date.now(),
      senderId: message.senderId,
    };

    let delivered = 0;
    for (const subscriber of recipients) {
      if (subscriber.socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      this.send(subscriber, { type: 'event', envelope });
      delivered += 1;
    }

    logger.debug(`Forwarded a ${target.method} message to ${target.to}; delivered to ${delivered} subscriber(s).`);
    return delivered;
  }

  private recipientsOf(target: Target): Subscriber[] {
    if (target.method === 'p2p') {
      const subscriber = this.subscribers.get(target.to);
      return subscriber === undefined ? [] : [subscriber];
    }

    const subscriberIds = this.topicToSubscriberIds.get(target.to);
    if (subscriberIds === undefined) {
      return [];
    }
    const recipients: Subscriber[] = [];
    for (const subscriberId of subscriberIds) {
      const subscriber = this.subscribers.get(subscriberId);
      if (subscriber !== undefined) {
        recipients.push(subscriber);
      }
    }
    return recipients;
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

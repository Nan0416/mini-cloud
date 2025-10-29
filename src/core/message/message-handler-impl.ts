import {
  BroadcastRequest,
  BroadcastResponse,
  ForwardTimestamp,
  GetMessageHubStatusRequest,
  GetMessageHubStatusResponse,
  InvalidRequestError,
  PublishTimestamp,
  SenderIdentifier,
  SendToRequest,
  SendToResponse,
  SubscriberRequest,
  Target,
} from '@ultrasa/mini-cloud-models';
import { v4 as uuidv4 } from 'uuid';
import WebSocket, { Server } from 'ws';
import { LoggerFactory } from '@ultrasa/dev-kit';
import { MessageHandler } from './message-handler';
import { Metrics, MetricsContext } from '@ultrasa/dev-kit';

// reference: https://github.com/allworldautomation/websocket-pubsub
const INVALID_REQUEST = 'InvalidRequest';
const INTERNAL_ERROR = 'InternalError';
const PUBLISHER_MESSAGE = 'PubisherMessage';
const SUBSCRIBERS_COUNT = 'Subscribers.Count';
const TOPICS_COUNT = 'Topics.Count';

/**
 * PubSubHub maintains the subscriber information, including
 * 1. subscriberId to subscribed topics.
 * 2. subscriberId to its websocket client object.
 *
 * Also a reverse index, topic to subscriberIds.
 */

const logger = LoggerFactory.getLogger('MessageHandlerImpl');
export class MessageHandlerImpl implements MessageHandler {
  private readonly subscriberIdToTopics: Map<string, Set<string>>;
  private readonly subscriberIdToWebsocket: Map<string, WebSocket>;
  private readonly topicToSubscriberIds: Map<string, Set<string>>;

  private readonly wsPort: number;
  private readonly wsServer: Server;
  private readonly metrics: Metrics;

  private preparingTermination: boolean;
  private metricsHandle: NodeJS.Timeout;

  constructor(wsPort: number, host?: string) {
    this.metrics = MetricsContext.getMetrics();
    this.wsPort = wsPort;
    this.wsServer = new WebSocket.Server({
      host: host,
      port: this.wsPort,
    });

    this.subscriberIdToTopics = new Map();
    this.subscriberIdToWebsocket = new Map();
    this.topicToSubscriberIds = new Map();
    this.preparingTermination = false;
    this.initializeWebsocketServer(this.wsServer);
    this.metricsHandle = setInterval(() => {
      this.metrics.count(SUBSCRIBERS_COUNT, this.subscriberIdToWebsocket.size);
      this.metrics.count(TOPICS_COUNT, this.topicToSubscriberIds.size);
    }, 60_000);
  }

  async getMessageHubStatus(request: GetMessageHubStatusRequest): Promise<GetMessageHubStatusResponse> {
    const topicToSubscriberCount: Record<string, number> = {};
    const topics = Array.from(this.topicToSubscriberIds.keys());
    for (let topic of topics) {
      const count = this.topicToSubscriberIds.get(topic)?.size;
      topicToSubscriberCount[topic] = typeof count === 'number' ? count : 0;
    }

    return {
      status: {
        totalSubscriberCount: this.subscriberIdToTopics.size,
        topicToSubscriberCount,
      },
    };
  }

  private initializeWebsocketServer(server: Server) {
    logger.info(`Initalize server websocket at port ${this.wsPort}.`);
    server.on('connection', (subscriberWebsocket) => {
      const subscriberId = uuidv4();

      logger.info(`Received subscriber connection request, subscriberId ${subscriberId}.`);
      this.subscriberIdToWebsocket.set(subscriberId, subscriberWebsocket);

      // the close is trigger when the websocket is closed no matter which side initiates the close
      subscriberWebsocket.on('close', (code, reason) => {
        logger.info(`Client ${subscriberId} closed connection. code: ${code}, reason: ${reason}.`);
        this.removeSubscriber(subscriberId);
        // seems like only one side needs to close the connection.
        // subscriberWebsocket.close(1000, 'Done');
      });

      subscriberWebsocket.on('message', (data) => {
        if (this.preparingTermination) {
          logger.info('Received client request but message hub is in terminated state.');
          // ignore all client side message when preparing termination.
          return;
        }

        let request: SubscriberRequest;

        try {
          request = JSON.parse(data.toString()) as SubscriberRequest;
        } catch (err: any) {
          logger.warn(`Failed to serialize user request ${data.toString()}`, err);
          this.metrics.incrementCounter(INVALID_REQUEST);
          return;
        }

        try {
          this.assert(
            request.action === 'subscribe' || request.action === 'unsubscribe' || request.action === 'ping' || request.action === 'broadcast' || request.action === 'p2p',
            `Invalid subscriber's action ${request.action}.`,
          );
          this.assert(typeof request.topic === 'string', 'Missing or invalid topic.');

          if (request.action === 'subscribe') {
            this.subscribe(subscriberId, request.topic);
          } else if (request.action === 'unsubscribe') {
            this.unsubscribe(subscriberId, request.topic);
          } else if (request.action === 'ping') {
            logger.info(`ping request from subscriber ${subscriberId}`);
          } else if (request.action === 'broadcast') {
            logger.info(`subscriber ${subscriberId} publishs data on topic ${request.topic}`);
            const event = request.payload as any & PublishTimestamp;
            this.assert(typeof event?._publishedAt === 'number', "Invalid subscriber's broadcast request due to invalid or missing _publishedAt.");
            this.publish(
              { method: 'broadcast', to: request.topic },
              {
                ...event,
                _senderId: subscriberId,
              },
            );
          } else if (request.action === 'p2p') {
            logger.info(`Subscriber ${subscriberId} sends data to subscriber ${request.topic}.`);
            const event = request.payload as any & PublishTimestamp;
            this.assert(typeof event?._publishedAt === 'number', "Invalid subscriber's p2p request due to invalid or missing _publishedAt.");
            this.publish(
              { method: 'p2p', to: request.topic },
              {
                ...event,
                _senderId: subscriberId,
              },
            );
          }
        } catch (err) {
          logger.warn(`Failed to handle subscriber request.`, err);
          this.metrics.incrementCounter(INVALID_REQUEST);
          return;
        }
      });
    });
  }

  async broadcast<E extends PublishTimestamp & SenderIdentifier>(request: BroadcastRequest<E>): Promise<BroadcastResponse> {
    this.publish({ method: 'broadcast', to: request.topic }, request.event);
    return {};
  }

  async sendTo<E extends PublishTimestamp & SenderIdentifier>(request: SendToRequest<E>): Promise<SendToResponse> {
    this.publish({ method: 'p2p', to: request.recipientId }, request.event);
    return {};
  }

  private publish(target: Target, event: any & PublishTimestamp & SenderIdentifier) {
    this.metrics.time(`${PUBLISHER_MESSAGE}.Latency`, Date.now() - event._publishedAt);
    this.metrics.incrementCounter(`${PUBLISHER_MESSAGE}.Count`);

    const evt: ForwardTimestamp = {
      ...event,
      _forwardedAt: Date.now(),
    };

    if (target.method === 'p2p') {
      logger.info(`Forward direct p2p message to ${target.to}.`);
      const clientWs = this.subscriberIdToWebsocket.get(target.to);
      if (clientWs) {
        clientWs.send(JSON.stringify(evt), (err) => {
          if (err === undefined || err === null) {
            logger.info(`Successfully forward p2p message to recipient ${target.to}.`);
          } else {
            logger.warn(`Failed to send event to recipient ${target.to}.`, err);
            this.metrics.incrementCounter(INTERNAL_ERROR);
          }
        });
      } else {
        logger.warn(`Can't find recipient ${target.to}.`);
      }
    } else if (target.method === 'broadcast') {
      logger.info(`Broadcast message to topic ${target.to}.`);
      const subscriberIds = this.topicToSubscriberIds.get(target.to);
      if (subscriberIds) {
        for (let subscriberId of subscriberIds) {
          const clientWs = this.subscriberIdToWebsocket.get(subscriberId);
          if (clientWs) {
            clientWs.send(JSON.stringify(evt), (err) => {
              if (err === undefined || err === null) {
                logger.info(`Successfully forward message to subscriber ${subscriberId}.`);
              } else {
                logger.warn(`Failed to send event to subscriber ${subscriberId}.`, err);
                this.metrics.incrementCounter(INTERNAL_ERROR);
              }
            });
          } else {
            logger.warn(`Can't find subscriber ${subscriberId} websocket.`);
          }
        }
      } else {
        logger.info(`Topic ${target.to} doesn't have subscribers.`);
      }
    }
  }

  async terminate() {
    logger.info('Websocket is preparing termination.');
    this.preparingTermination = true;
    clearInterval(this.metricsHandle);
    this.subscriberIdToWebsocket.forEach((ws) => {
      ws.close(1000, 'ServerEnd');
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));
    // if the server side is closed without closing client ws, then both side .onclose will receive 1006.
    this.wsServer.close();
    logger.info('Websocket terminated.');
  }

  private removeSubscriber(subscriberId: string) {
    this.subscriberIdToWebsocket.delete(subscriberId);
    this.subscriberIdToTopics.delete(subscriberId);
    this.topicToSubscriberIds.forEach((v) => v.delete(subscriberId));
  }

  private subscribe(subscriberId: string, topic: string) {
    logger.info(`Subscribe ${subscriberId} to ${topic}.`);
    let subscriberIds = this.topicToSubscriberIds.get(topic);
    if (subscriberIds === undefined) {
      subscriberIds = new Set();
    }
    subscriberIds.add(subscriberId);
    this.topicToSubscriberIds.set(topic, subscriberIds);

    let topics = this.subscriberIdToTopics.get(subscriberId);
    if (topics === undefined) {
      topics = new Set();
    }
    topics.add(topic);
    this.subscriberIdToTopics.set(subscriberId, topics);
  }

  private unsubscribe(subscriberId: string, topic: string) {
    logger.info(`Unsubscribe ${subscriberId} from ${topic}.`);

    let subscriberIds = this.topicToSubscriberIds.get(topic);
    if (subscriberIds) {
      subscriberIds.delete(subscriberId);
    }

    let topics = this.subscriberIdToTopics.get(subscriberId);
    if (topics) {
      topics.delete(topic);
    }
  }

  private assert(condition: boolean, message: string) {
    if (!condition) {
      throw new InvalidRequestError(message);
    }
  }
}

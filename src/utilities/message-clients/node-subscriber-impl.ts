import { LoggerFactory } from '@sparrow/logging-js';
import {
  BroadcastRequest,
  BroadcastResponse,
  ForwardTimestamp,
  InternalServiceError,
  PublishTimestamp,
  SenderIdentifier,
  SendToRequest,
  SendToResponse,
  Subscriber,
  SubscriberRequest,
} from '../../models';
import WebSocket from 'ws';
import { evtCleanup } from './internal-utils';
import { nanoid } from 'nanoid';
import { Metrics } from '@sparrow/metrics-types';
import { MetricsContext } from '@sparrow/metrics-logger';

const logger = LoggerFactory.getLogger('NodeSubscriberImpl');
const OPEN_MESSAGE_WS_LATENCY = 'OpenMessageWsLatency';
const TOTAL_MESSAGE_LATENCY = 'TotalMessageLatency';
const FORWARD_MESSAGE_LATENCY = 'ForwardMessageLatency';
const WS_ERROR = 'WsErrorCount';
const WS_CLOSE = 'WsCloseCount';

/**
 * ToDo support authentication.
 */
export class NodeSubscriberImpl<T> implements Subscriber<T> {
  private readonly domain: string;

  private ws?: WebSocket;
  private readonly metrics: Metrics;
  private readonly logMeta: any;

  private terminated: boolean;
  private initialized: boolean;
  private connected: boolean;
  private pingJob?: NodeJS.Timeout;
  private pongTimeout?: NodeJS.Timeout;

  private initResolve?: () => void;
  private initReject?: (err: any) => void;

  onEvent: (event: T, senderId?: string) => void;
  onClose: (code: number, reason: string) => void;

  constructor(domain: string) {
    this.domain = domain;
    this.metrics = MetricsContext.getMetrics();
    this.terminated = false;
    this.initialized = false;
    this.connected = false;
    this.logMeta = { identifier: nanoid() };
    this.onClose = () => {};
    this.onEvent = () => {};
  }

  init(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.terminated) {
        const message = 'Websocket is already terminated.';
        logger.warn(message, this.logMeta);
        reject(new InternalServiceError(message));
        return;
      }

      if (this.initialized) {
        const message = 'Websocket is already initialized.';
        logger.warn(message, this.logMeta);
        reject(new InternalServiceError(message));
        return;
      }

      this.initialized = true;
      logger.info('Initializing subscriber websocket.', this.logMeta);

      this.initResolve = resolve;
      this.initReject = reject;

      logger.info(`Create subscriber websocket object point to ${this.domain}.`, this.logMeta);
      this.ws = new WebSocket(this.domain);

      this.pingJob = setInterval(() => {
        if (!this.terminated && this.initialized && this.connected && this.ws !== undefined) {
          logger.debug('Send ping request to message server.', this.logMeta);
          this.pongTimeout = setTimeout(() => {
            logger.warn('Did not receive pong response within 5 seconds timeout.', this.logMeta);
            this.onClose ? this.onClose(1006, 'Ping pong detected close.') : 0;
          }, 5_000);
          this.ws.ping();
        }
      }, 60_000);

      this.configureWebsocket(this.ws);
    });
  }

  async subscribe(topic: string): Promise<void> {
    logger.info(`Send request to subscribe ${topic}.`, this.logMeta);
    await this.sendRequest({ topic, action: 'subscribe' });
  }

  async unsubscribe(topic: string): Promise<void> {
    logger.info(`Send request to unsubscribe ${topic}.`, this.logMeta);
    await this.sendRequest({ topic, action: 'unsubscribe' });
  }

  async broadcast<E extends PublishTimestamp & SenderIdentifier>(request: BroadcastRequest<E>): Promise<BroadcastResponse> {
    logger.info(`Send request to broadcast event on ${request.topic}.`, this.logMeta);
    await this.sendRequest({ topic: request.topic, action: 'broadcast', payload: request.event });
    return {};
  }

  async sendTo<E extends PublishTimestamp & SenderIdentifier>(request: SendToRequest<E>): Promise<SendToResponse> {
    logger.info(`Send request to recipient ${request.recipientId}.`, this.logMeta);
    await this.sendRequest({ topic: request.recipientId, action: 'p2p', payload: request.event });
    return {};
  }

  private sendRequest(request: SubscriberRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws !== undefined && this.connected && !this.terminated) {
        this.ws.send(JSON.stringify(request), (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } else if (this.terminated) {
        const message = 'sendRequest method failed because websocket connection has been terminate.';
        logger.warn(message, this.logMeta);
        reject(new InternalServiceError(message));
      } else {
        const message = 'Websocket connection is not in a ready state.';
        logger.warn(message, this.logMeta);
        reject(new InternalServiceError(message));
      }
    });
  }

  async close(): Promise<void> {
    /**
     * 1000, normal
     * 1005, no code received
     * 1006, abnormal
     */
    this.terminated = true;
    logger.info('Close websocket.', this.logMeta);
    this.cleanup();
    if (this.ws !== undefined) {
      this.ws.close(1000, 'Normal Closure');
      this.ws = undefined;
    }
  }

  private cleanup(): void {
    this.pingJob ? clearInterval(this.pingJob) : 0;
    this.pingJob = undefined;
    this.pongTimeout ? clearTimeout(this.pongTimeout) : 0;
    this.pongTimeout = undefined;
  }

  private configureWebsocket(ws: WebSocket) {
    const timestamp = Date.now();
    ws.on('open', () => {
      this.metrics.time(OPEN_MESSAGE_WS_LATENCY, Date.now() - timestamp);
      // don't have an authentication yet.
      logger.info('Subscriber websocket opened.', this.logMeta);
      this.initResolve ? this.initResolve() : 0;
      this.initResolve = undefined;
      this.initReject = undefined;
      this.connected = true;
    });

    ws.on('message', (data: string) => {
      const evt = JSON.parse(data) as PublishTimestamp & ForwardTimestamp & SenderIdentifier;
      const senderId = evt._senderId;
      this.metrics.time(TOTAL_MESSAGE_LATENCY, Date.now() - evt._publishedAt);
      this.metrics.time(FORWARD_MESSAGE_LATENCY, Date.now() - evt._forwardedAt);
      logger.debug('Websocket received message' + (senderId ? ` from sender ${senderId}.` : ' without sender id.'), this.logMeta);
      this.onEvent(evtCleanup<T>(evt), senderId);
    });

    ws.on('error', (err) => {
      this.metrics.incrementCounter(WS_ERROR);
      /**
       * One of the error I encountered is a timeout error when creating a new websocket client object.
       * Error: connect ETIMEDOUT 54.152.174.98:443
       *  at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1161:16)
       *
       * The timeout cause is unknown, it was not caused by busy CPU or system issue, the CPU usage was
       * at normal range at that time.
       *
       * Another error I encountered on 2023-03-13 was
       * Error: getaddrinfo ENOTFOUND stream-beta.qinnan.dev
       *  at GetAddrInfoReqWrap.onlookup [as oncomplete] (node:dns:71:26)
       *
       * The DNS error cause is unknown. The error lead the call on this.initReject and throw exception throw the init method.
       * It also triggers the ws.on('close', ) callback, which lead auto reconnect.
       */
      logger.error(`Subscriber ws error.`, err);
      this.initReject ? this.initReject(err) : 0;
      this.initResolve = undefined;
      this.initReject = undefined;
    });

    ws.on('close', (code: number, reason: string) => {
      // both client side initiated close and server side initiated close will trigger the method.
      logger.info(`Websocket closed ${code} ${reason}.`, this.logMeta);
      this.connected = false;
      this.metrics.incrementCounter(WS_CLOSE + (typeof code === 'number' ? code.toString() : 'unknown'));
      this.cleanup();
      this.onClose(code, reason);
    });

    ws.on('pong', () => {
      logger.debug('Received pong from message server.', this.logMeta);
      this.pongTimeout ? clearTimeout(this.pongTimeout) : 0;
      this.pongTimeout = undefined;
    });
  }
}

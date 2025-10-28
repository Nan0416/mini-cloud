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
import { ICloseEvent, IMessageEvent, w3cwebsocket } from 'websocket'; // support both node.js and browser.
import { evtCleanup } from './internal-utils';
import { Metrics } from '@sparrow/metrics-types';
import { MetricsContext } from '@sparrow/metrics-logger';

export interface SubscriberOptions {
  readonly autoReconnect: boolean;
}

const OPEN_MESSAGE_WS_LATENCY = 'OpenMessageWsLatency';
const TOTAL_MESSAGE_LATENCY = 'TotalMessageLatency';
const FORWARD_MESSAGE_LATENCY = 'ForwardMessageLatency';
const WS_ERROR = 'WsErrorCount';
const WS_CLOSE = 'WsCloseCount';

const PING_REQUEST: SubscriberRequest = { action: 'ping', topic: '' };
const logger = LoggerFactory.getLogger('SubscriberImpl');

/**
 * @deprecated
 *
 * Use NodeSubscriberImpl instead, it provides better backend support.
 */
export class SubscriberImpl<T> implements Subscriber<T> {
  private readonly domain: string;
  private readonly metrics: Metrics;

  private ws?: w3cwebsocket;
  private pingJob: NodeJS.Timeout;
  private connected: boolean;

  onEvent: (event: T, senderId?: string) => void;
  onClose: (code: number, reason: string) => void;

  constructor(domain: string) {
    this.domain = domain;
    this.metrics = MetricsContext.getMetrics();
    this.connected = false;
    this.onClose = () => {};
    this.onEvent = () => {};
    this.pingJob = setInterval(() => {
      if (this.ws !== undefined && this.connected) {
        // the websocket package seems not support client side ping request.
        logger.debug('Websocket send ping request to keep connection open.');
        // throw error: cannot call send() while not connected, even when the connected true...
        this.ws.send(JSON.stringify(PING_REQUEST));
      }
    }, 3_600_000); // 1hour, nginx is configured to close connection after 12 hours if no traffic.
  }

  init(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new w3cwebsocket(this.domain, 'echo-protocol');
      this.configureWebsocket(this.ws, resolve, reject);
    });
  }

  async subscribe(topic: string): Promise<void> {
    logger.info(`Send request to subscribe ${topic}.`);
    await this.sendRequest({ topic, action: 'subscribe' });
  }

  async unsubscribe(topic: string): Promise<void> {
    logger.info(`Send request to unsubscribe ${topic}.`);
    await this.sendRequest({ topic, action: 'unsubscribe' });
  }

  async broadcast<E extends PublishTimestamp & SenderIdentifier>(request: BroadcastRequest<E>): Promise<BroadcastResponse> {
    logger.info(`Send request to broadcast event on ${request.topic}.`);
    await this.sendRequest({ topic: request.topic, action: 'broadcast', payload: request.event });
    return {};
  }

  async sendTo<E extends PublishTimestamp & SenderIdentifier>(request: SendToRequest<E>): Promise<SendToResponse> {
    logger.info(`Send request to recipient ${request.recipientId}.`);
    await this.sendRequest({ topic: request.recipientId, action: 'p2p', payload: request.event });
    return {};
  }

  private sendRequest(request: SubscriberRequest): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.ws.send(JSON.stringify(request));
        resolve();
      } else {
        reject(new InternalServiceError('Websocket has not been initialized.'));
      }
    });
  }

  async close(): Promise<void> {
    /**
     * 1000, normal
     * 1005, no code received
     * 1006, abnormal
     */
    logger.info('Client side initiates close.');
    this.ws?.close(1000, 'Normal Closure');
    this.cleanup();
  }

  private cleanup(): void {
    // attention: must cleanup the custom ping request, otherwise, the w3c websocket implementation will
    // throw "cannot call send() while not connected" error. I found the error caught by "UncaughtException"
    // handler.
    clearInterval(this.pingJob);
    this.ws = undefined;
  }

  private configureWebsocket(ws: w3cwebsocket, onOpen: () => void, reject: (err: any) => void) {
    const timestamp = Date.now();
    ws.onopen = () => {
      this.metrics.time(OPEN_MESSAGE_WS_LATENCY, Date.now() - timestamp);
      this.connected = true;
      onOpen();
    };

    ws.onmessage = (message: IMessageEvent) => {
      const evt = JSON.parse(message.data as string) as PublishTimestamp & ForwardTimestamp & SenderIdentifier;
      const senderId = evt._senderId;
      this.metrics.time(TOTAL_MESSAGE_LATENCY, Date.now() - evt._publishedAt);
      this.metrics.time(FORWARD_MESSAGE_LATENCY, Date.now() - evt._forwardedAt);
      logger.debug('Websocket received message' + (senderId ? ` from sender ${senderId}.` : ' without sender id.'));
      this.onEvent(evtCleanup<T>(evt), senderId);
    };

    ws.onerror = (err) => {
      logger.error(`Subscriber ws error.`, err);
      this.metrics.incrementCounter(WS_ERROR);
      reject(err);
    };

    ws.onclose = (evt: ICloseEvent) => {
      // both client side initiated close and server side initiated close will trigger the method.
      logger.info(`Closed event ${evt.code} ${evt.reason}.`);
      this.connected = false;
      this.metrics.incrementCounter(WS_CLOSE + (typeof evt.code === 'number' ? evt.code.toString() : 'unknown'));
      this.cleanup();
      this.onClose(evt.code, evt.reason);
    };
  }
}

import lodash from 'lodash';
import { LoggerFactory } from '@sparrow/logging-js';
import { LinearBackoff, RetryBackoff } from '../retry-backoffs';
import { BroadcastRequest, BroadcastResponse, InternalServiceError, PublishTimestamp, SenderIdentifier, SendToRequest, SendToResponse, Subscriber } from '../../models';
import { Metrics } from '@sparrow/metrics-types';
import { MetricsContext } from '@sparrow/metrics-logger';

export type SubscriberProvider<T> = () => Subscriber<T>;

const ABNORMAL_CLOSE_COUNT = 'AbnormalCloseCount';
const UNDESIRED_CLOSE_COUNT = 'UndesiredCloseCount';

const logger = LoggerFactory.getLogger('StatefulWsSubscriber');

export class StatefulWsSubscriber<T> implements Subscriber<T> {
  private readonly metrics: Metrics;
  private subscribedTopics: string[];
  private readonly subscriberProvider: SubscriberProvider<T>;
  private readonly retryBackoff: RetryBackoff;
  private terminated: boolean;
  // a stateless subscriber
  private subscriber?: Subscriber<T>;

  private onEvent_: (event: T, senderId?: string) => void;
  private onClose_: (code: number, reason: string) => void;

  constructor(subscriberProvider: SubscriberProvider<T>) {
    this.subscriberProvider = subscriberProvider;
    this.subscribedTopics = [];
    this.onClose_ = () => {};
    this.onEvent_ = () => {};
    this.terminated = false;
    this.retryBackoff = new LinearBackoff({
      minimumBackoff: 100,
      maxmiumBackoff: 500,
      factor: 1.5,
    });
    this.metrics = MetricsContext.getMetrics();
  }

  async sendTo<E extends PublishTimestamp & SenderIdentifier>(request: SendToRequest<E>): Promise<SendToResponse> {
    logger.info(`Send direct p2p message to recipient ${request.recipientId}.`);
    if (this.subscriber) {
      await this.subscriber.sendTo(request);
    } else {
      const message = 'Failed to publish event because subscriber is not ready.';
      throw new InternalServiceError(message);
    }
    return {};
  }

  async broadcast<E extends PublishTimestamp & SenderIdentifier>(request: BroadcastRequest<E>): Promise<BroadcastResponse> {
    logger.info(`broadcast event to topic ${request.topic}`);
    if (this.subscriber) {
      await this.subscriber.broadcast(request);
    } else {
      const message = 'Failed to publish event because subscriber is not ready.';
      throw new InternalServiceError(message);
    }
    return {};
  }

  get onEvent(): (event: T, senderId?: string) => void {
    return this.onEvent_;
  }

  set onEvent(onevt: (event: T, senderId?: string) => void) {
    logger.info('Update subscriber event handler.');
    this.onEvent_ = onevt;
    if (this.subscriber) {
      this.subscriber.onEvent = onevt;
    }
  }

  get onClose(): (code: number, reason: string) => void {
    return this.onClose_;
  }

  set onClose(onclose: (code: number, reason: string) => void) {
    this.onClose_ = onclose;
  }

  async init(): Promise<void> {
    if (this.terminated) {
      const message = 'Stateful susbcriber terminate method has been called.';
      logger.error(message);
      throw new Error(message);
    }

    logger.info('Initialize stateful susbcriber.');
    await this.connect();
  }

  private async connect() {
    await this.retryBackoff.backoff();
    logger.info('Create subscriber object to connect.');
    this.subscriber = this.subscriberProvider();
    this.configureSubscriber(this.subscriber);

    /**
     * The init method may throw error, such as network connection failure.
     * The underlying websocket's onclose event will be triggered, and it will lead reconnection automatically.
     */
    logger.info('Initialize websocket connection.');
    await this.subscriber.init();
    this.retryBackoff.reset();

    logger.info('Subscribe to the previous topics.');
    const partitonedTopics = lodash.chunk(this.subscribedTopics, 30);

    for (let i = 0; i < partitonedTopics.length; i++) {
      await Promise.all(
        partitonedTopics[i].map(async (topic) => {
          try {
            await this.subscriber?.subscribe(topic);
          } catch (err) {
            /**
             * At the moment we re-subscribe to the previous topics, the new websocket can disconnect again, and the following
             * subscribe method will throw errorr
             */
            logger.warn(`Failed to re-subscribe`, err);
          }
        }),
      );
    }
  }

  private async reconnect(): Promise<void> {
    if (this.terminated) {
      logger.info('Stateful websocket has been terminated.');
      return;
    }
    logger.info('Close the pervious disconnected stateles websocket and reconnect.');
    // terminate the current one.
    await this.subscriber?.close();
    await this.connect();
  }

  private configureSubscriber(subscriber: Subscriber<T>) {
    logger.info('Setup stateless websocket event handler and onclose handler.');
    subscriber.onClose = async (code, reason) => {
      this.onClose_(code, reason);

      if (this.terminated) {
        logger.info('Websocket closed and the subscriber is terminated.');
        return;
      }

      if (code === 1006) {
        logger.warn('Stateless websocket is abormal closed, auto reconnect.');
        this.metrics.incrementCounter(ABNORMAL_CLOSE_COUNT);
      } else {
        logger.warn(`Stateless websocket is closed with code ${code} but it's not supposed to close, reconnect.`);
        this.metrics.incrementCounter(UNDESIRED_CLOSE_COUNT);
      }

      await this.reconnect();
    };
    subscriber.onEvent = this.onEvent_;
  }

  async subscribe(topic: string): Promise<void> {
    logger.info(`Subscribe topic ${topic}.`);
    if (!this.subscribedTopics.find((t) => t === topic)) {
      this.subscribedTopics.push(topic);
      await this.subscriber?.subscribe(topic);
    }
  }

  async unsubscribe(topic: string): Promise<void> {
    logger.info(`Unsubscribe topic ${topic}.`);
    const length = this.subscribedTopics.length;
    this.subscribedTopics = this.subscribedTopics.filter((topic_) => topic_ !== topic);
    if (length > this.subscribedTopics.length) {
      await this.subscriber?.unsubscribe(topic);
    }
  }

  async close(): Promise<void> {
    this.terminated = true;
    await this.subscriber?.close();
    this.subscriber = undefined;
  }
}

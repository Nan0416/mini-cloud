import { HttpClient } from '@sparrow/http-client';
import { LoggerFactory } from '@sparrow/logging-js';
import { Publisher, PublishTimestamp } from '../../models';

const logger = LoggerFactory.getLogger('PublisherImpl');
export class PublisherImpl implements Publisher {
  private readonly httpClient: HttpClient;
  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  async publish<T>(topic: string, event: T): Promise<void> {
    await this.broadcast(topic, event);
  }

  async broadcast<T>(topic: string, event: T): Promise<void> {
    const evt: PublishTimestamp = {
      ...event,
      _publishedAt: Date.now(),
    };
    logger.info(`Broadcast message to topic ${topic}.`);
    await this.httpClient.send({
      method: 'POST',
      url: '/message/broadcast',
      query: {
        topic: encodeURIComponent(topic),
      },
      body: evt,
    });
  }

  async sendTo<T>(recipientId: string, event: T): Promise<void> {
    const evt: PublishTimestamp = {
      ...event,
      _publishedAt: Date.now(),
    };
    logger.info(`Send direct p2p message to recipient ${recipientId}.`);
    await this.httpClient.send({
      method: 'POST',
      url: '/message/p2p',
      query: {
        recipientId: encodeURIComponent(recipientId),
      },
      body: evt,
    });
  }
}

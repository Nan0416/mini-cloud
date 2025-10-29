import { LoggerFactory, HttpClient } from '@ultrasa/dev-kit';
import { BroadcastRequest, BroadcastResponse, Publisher, PublishTimestamp, SenderIdentifier, SendToRequest, SendToResponse } from '@ultrasa/mini-cloud-models';

const logger = LoggerFactory.getLogger('PublisherImpl');
export class PublisherImpl implements Publisher {
  private readonly httpClient: HttpClient;
  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  async broadcast<E extends PublishTimestamp & SenderIdentifier>(request: BroadcastRequest<E>): Promise<BroadcastResponse> {
    logger.info(`Broadcast message to topic ${request.topic}.`);
    await this.httpClient.send({
      method: 'POST',
      url: '/message/broadcast',
      query: {
        topic: encodeURIComponent(request.topic),
      },
      body: request.event,
    });

    return {};
  }

  async sendTo<E extends PublishTimestamp & SenderIdentifier>(request: SendToRequest<E>): Promise<SendToResponse> {
    logger.info(`Send direct p2p message to recipient ${request.recipientId}.`);
    const response = await this.httpClient.send<SendToResponse>({
      method: 'POST',
      url: '/message/p2p',
      query: {
        recipientId: encodeURIComponent(request.recipientId),
      },
      body: request.event,
    });
    return response.body;
  }
}

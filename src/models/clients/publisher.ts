import { PublishTimestamp, SenderIdentifier } from '../models';

export interface BroadcastRequest<E extends PublishTimestamp & SenderIdentifier> {
  readonly topic: string;
  readonly event: E;
}

export interface BroadcastResponse {}

export interface SendToRequest<E extends PublishTimestamp & SenderIdentifier> {
  readonly recipientId: string;
  readonly event: E;
}

export interface SendToResponse {}

export interface Publisher {
  broadcast<E extends PublishTimestamp & SenderIdentifier>(request: BroadcastRequest<E>): Promise<BroadcastResponse>;

  sendTo<E extends PublishTimestamp & SenderIdentifier>(request: SendToRequest<E>): Promise<SendToResponse>;
}

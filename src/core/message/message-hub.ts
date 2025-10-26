import { MessageHubStatus, PublishTimestamp, SenderIdentifier, Target } from '../../models/models/message-types';

export interface MessageHub {
  getStatus(): MessageHubStatus;

  publish(target: Target, event: any & PublishTimestamp & SenderIdentifier): void;

  terminate(): Promise<void>;
}

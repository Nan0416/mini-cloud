export interface MessageHubStatus {
  readonly totalSubscriberCount: number;
  readonly topicToSubscriberCount: Record<string, number>;
}

export interface PublishTimestamp {
  readonly _publishedAt: number;
}

export interface ForwardTimestamp {
  readonly _forwardedAt: number;
}

export interface SenderIdentifier {
  readonly _senderId?: string;
}

export interface Target {
  readonly method: 'broadcast' | 'p2p';
  readonly to: string; // topic or subscriberId;
}

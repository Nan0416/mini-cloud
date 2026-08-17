import { HubStatus } from '../models/pubsub';

/**
 * Epoch ms the publisher stamped the message.
 *
 * Optional in the contract but required on the wire: `MiniCloudClient` fills it in on
 * the way out, so no first-party caller has to think about it, while the service
 * still rejects a hand-rolled request that omits it. Defaulting it service-side
 * instead would report every such message as having taken zero milliseconds, which
 * reads as a fast hub rather than as a missing measurement.
 */
interface PublishTimestamp {
  readonly publishedAt?: number;
}

/** Fan a message out to every subscriber of a topic. */
export interface BroadcastRequest extends PublishTimestamp {
  readonly topic: string;
  readonly payload: unknown;
}

export interface BroadcastResponse {
  /** Number of subscribers the message was forwarded to. */
  readonly deliveredTo: number;
}

/** Send a message to one named subscriber. */
export interface SendToRequest extends PublishTimestamp {
  /** Subscriber id, as carried by `EventEnvelope.senderId` or announced on connect. */
  readonly recipientId: string;
  readonly payload: unknown;
}

export interface SendToResponse {
  /** 1 when the recipient is connected, 0 when it is not. Never an error: a
   * subscriber that has dropped off is the normal case, not a caller mistake. */
  readonly deliveredTo: number;
}

export interface GetHubStatusRequest {}

export interface GetHubStatusResponse {
  readonly status: HubStatus;
}

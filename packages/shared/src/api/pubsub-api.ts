import { HubStatus } from '../models/pubsub';

/** Publish over HTTP, for callers that do not hold a WebSocket. */
export interface PublishRequest {
  readonly topic: string;
  readonly payload: unknown;
}

export interface PublishResponse {
  /** Number of subscribers the message was forwarded to. */
  readonly deliveredTo: number;
}

export interface GetHubStatusRequest {}

export interface GetHubStatusResponse {
  readonly status: HubStatus;
}

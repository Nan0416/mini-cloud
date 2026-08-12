/**
 * Topic every agent subscribes to, for fleet-wide commands such as heartbeat probes.
 */
export const AGENT_BROADCAST_TOPIC = 'mini-cloud.agents';

/**
 * Per-agent command topic.
 *
 * Targeted commands go here rather than to the broadcast topic so that launching on
 * one agent does not wake the whole fleet — the old design broadcast every launch to
 * every agent and had each one discard the messages addressed to someone else.
 */
export function agentTopic(agentId: string): string {
  return `mini-cloud.agent.${agentId}`;
}

/**
 * A delivered message. Transport metadata rides alongside the payload rather than
 * being merged into it, so a payload is never mutated in flight.
 */
export interface EventEnvelope<T = unknown> {
  readonly topic: string;
  readonly payload: T;
  /** Epoch ms the publisher stamped the message. */
  readonly publishedAt: number;
  /** Epoch ms the hub forwarded it. The gap is queueing latency. */
  readonly forwardedAt: number;
  /** Subscriber id of the sender; absent when published over HTTP. */
  readonly senderId?: string;
}

export type SubscriberAction = 'subscribe' | 'unsubscribe' | 'publish' | 'ping';
export const SUBSCRIBER_ACTIONS: ReadonlyArray<SubscriberAction> = ['subscribe', 'unsubscribe', 'publish', 'ping'];

/** Subscriber -> hub, over the WebSocket. */
export interface SubscriberRequest {
  readonly action: SubscriberAction;
  /** Ignored for `ping`. */
  readonly topic: string;
  /** Required for `publish`. */
  readonly payload?: unknown;
}

/** Hub -> subscriber, over the WebSocket. */
export type HubMessage =
  | { readonly type: 'welcome'; readonly subscriberId: string }
  | { readonly type: 'event'; readonly envelope: EventEnvelope }
  | { readonly type: 'ack'; readonly action: SubscriberAction; readonly topic: string }
  | { readonly type: 'error'; readonly message: string };

export interface HubStatus {
  readonly subscriberCount: number;
  readonly topicToSubscriberCount: Readonly<Record<string, number>>;
}

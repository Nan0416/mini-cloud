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
 * How a message is addressed: fanned out to everyone on a topic, or handed to one
 * named subscriber.
 */
export type DeliveryMethod = 'broadcast' | 'p2p';
export const DELIVERY_METHODS: ReadonlyArray<DeliveryMethod> = ['broadcast', 'p2p'];

/**
 * Where a message is going.
 *
 * `to` is a topic for a broadcast and a subscriber id for a p2p message. The two are
 * carried in one field with `method` as the discriminant rather than as an overloaded
 * `topic` string: the same value meaning two different things with no marker is what
 * made the delivery path ambiguous to read.
 */
export interface Target {
  readonly method: DeliveryMethod;
  readonly to: string;
}

/**
 * A delivered message. Transport metadata rides alongside the payload rather than
 * being merged into it, so a payload is never mutated in flight.
 */
export interface EventEnvelope<T = unknown> {
  readonly target: Target;
  readonly payload: T;
  /**
   * Epoch ms the publisher stamped the message, before it crossed the network. Set
   * by the publisher rather than the hub, which is what makes `forwardedAt -
   * publishedAt` a real end-to-end latency instead of always zero.
   */
  readonly publishedAt: number;
  /** Epoch ms the hub forwarded it. The gap is publish-to-delivery latency. */
  readonly forwardedAt: number;
  /**
   * Subscriber id of the sender.
   *
   * Assigned by the hub from the sending connection, never accepted from a caller —
   * a publisher that could name itself could impersonate any subscriber. Absent for
   * HTTP publishers, which hold no connection and so publish anonymously.
   */
  readonly senderId?: string;
}

export type SubscriberAction = 'subscribe' | 'unsubscribe' | 'broadcast' | 'p2p' | 'ping';
export const SUBSCRIBER_ACTIONS: ReadonlyArray<SubscriberAction> = ['subscribe', 'unsubscribe', 'broadcast', 'p2p', 'ping'];

/**
 * Subscriber -> hub, over the WebSocket.
 *
 * A union rather than one interface with everything optional, so the hub cannot read
 * a `recipientId` off a broadcast or forget that publishing requires a timestamp.
 */
export type SubscriberRequest =
  | { readonly action: 'subscribe' | 'unsubscribe'; readonly topic: string }
  | { readonly action: 'broadcast'; readonly topic: string; readonly publishedAt: number; readonly payload: unknown }
  | { readonly action: 'p2p'; readonly recipientId: string; readonly publishedAt: number; readonly payload: unknown }
  | { readonly action: 'ping' };

/** Hub -> subscriber, over the WebSocket. */
export type HubMessage =
  | { readonly type: 'welcome'; readonly subscriberId: string }
  | { readonly type: 'event'; readonly envelope: EventEnvelope }
  | {
      readonly type: 'ack';
      readonly action: SubscriberAction;
      /** Topic, recipient id, or empty for `ping`. */
      readonly to: string;
      /** How many subscribers received it. Only set for `broadcast` and `p2p`. */
      readonly deliveredTo?: number;
    }
  | { readonly type: 'error'; readonly message: string };

export interface HubStatus {
  readonly subscriberCount: number;
  readonly topicToSubscriberCount: Readonly<Record<string, number>>;
}

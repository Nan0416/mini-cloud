import { Publisher } from './publisher';

export interface Subscriber<T> extends Publisher {
  init(): Promise<void>;
  subscribe(topic: string): Promise<void>;
  unsubscribe(topic: string): Promise<void>;
  close(): Promise<void>;

  /**
   * event
   * senderId: the publisher identifier. anonymous if undefined.
   */
  onEvent: (event: T, senderId?: string) => void;
  onClose: (code: number, reason: string) => void;
}

export interface SubscriberRequest {
  /**
   * subscribe: subscribe to a topic.
   * unsubscribe: unsubscribe a topic
   * ping: ping message server to keep websocket connection open
   * broadcase: broadcase message to the topic. (publisher action)
   * p2p: send message to a specific subscriber, the topic is the subscriberId.
   */
  readonly action: 'subscribe' | 'unsubscribe' | 'ping' | 'broadcast' | 'p2p';
  readonly topic: string;
  readonly payload?: any;
}

export interface Listener<T> {
  onEvent?: (event: T, senderId?: string) => void;
  readonly id: string;
}

export interface Fanout<T> {
  onEvent: (event: T, senderId?: string) => void;

  register(listener?: (event: T, senderId?: string) => void): Listener<T>;
  deregister(listenerId: string): boolean;
}

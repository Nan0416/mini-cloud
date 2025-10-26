export interface Publisher {
  /**
   * @deprecated
   * @param topic
   * @param event
   */
  publish<T>(topic: string, event: T): Promise<void>;

  broadcast<E>(topic: string, event: E): Promise<void>;

  sendTo<E>(recipientId: string, event: E): Promise<void>;
}

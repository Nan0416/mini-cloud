import { Publisher } from '../../models';

export class NoopPublisher implements Publisher {
  async publish<T>(topic: string, event: T): Promise<void> {}
  async broadcast<E>(topic: string, event: E): Promise<void> {}
  async sendTo<E>(recipientId: string, event: E): Promise<void> {}
}

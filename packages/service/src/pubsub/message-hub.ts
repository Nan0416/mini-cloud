import { HubStatus } from '@mini-cloud/shared';

export interface MessageHub {
  /**
   * Forwards `payload` to every subscriber of `topic`. Returns how many received it.
   *
   * Callers inside the service use this directly rather than going through HTTP —
   * the hub is a component of the service, not a separate deployable.
   */
  publish(topic: string, payload: unknown, senderId?: string): number;

  getStatus(): HubStatus;

  terminate(): Promise<void>;
}

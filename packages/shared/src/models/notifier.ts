/**
 * A notifier is somewhere mini-cloud can send a message: a Discord channel's webhook
 * today, an email address later. It knows nothing about what the message is for, so a
 * monitor's alarm is one sender among those still to come.
 */

export type NotifierType = 'discord';

export const NOTIFIER_TYPES: ReadonlyArray<NotifierType> = ['discord'];

export const NOTIFIER_LIMITS = {
  nameLength: 100,
  descriptionLength: 1024,
  channelLength: 100,
  /** How many notifiers one monitor may send to. */
  perMonitor: 10,
} as const;

/** A Discord channel as written: the webhook URL is the credential, so it is only ever sent, never read back. */
export interface DiscordTargetInput {
  readonly type: 'discord';
  /** The channel's name, as the operator calls it. The webhook URL only carries its id. */
  readonly channel: string;
  /** Required when the notifier is created; left out of an update, the stored one is kept. */
  readonly webhookUrl?: string;
}

export type NotifierTargetInput = DiscordTargetInput;

/** A Discord channel as read: the webhook's id, which tells two webhooks apart without being able to post to either. */
export interface DiscordTarget {
  readonly type: 'discord';
  readonly channel: string;
  readonly webhookId: string;
}

export type NotifierTarget = DiscordTarget;

export interface Notifier {
  /** Assigned by the service, and what everything that sends to the notifier refers to it by. */
  readonly notifierId: string;
  /** Unique, and free to change. */
  readonly name: string;
  readonly description?: string;
  readonly target: NotifierTarget;
  /** Bumped on every save; an update must name the one it was made from. */
  readonly version: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

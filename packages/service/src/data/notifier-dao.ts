import { Notifier, NotifierTarget } from '@mini-cloud/shared';

/** What it takes to post to a Discord webhook. Never leaves the service. */
export interface DiscordCredentials {
  readonly type: 'discord';
  readonly webhookUrl: string;
}

export type NotifierCredentials = DiscordCredentials;

/** A notifier with what it takes to send to it. */
export interface DeliveryTarget {
  readonly notifier: Notifier;
  readonly credentials: NotifierCredentials;
}

export interface ListNotifiersInput {}

export interface ListNotifiersOutput {
  readonly notifiers: ReadonlyArray<Notifier>;
}

export interface GetNotifierInput {
  readonly notifierId: string;
}

export interface GetNotifierOutput {
  readonly notifier?: Notifier;
}

export interface CreateNotifierInput {
  readonly notifierId: string;
  readonly name: string;
  readonly description?: string;
  readonly target: NotifierTarget;
  readonly credentials: NotifierCredentials;
}

export interface CreateNotifierOutput {
  /** Absent when the name was already taken, and nothing was written. */
  readonly notifier?: Notifier;
}

export interface UpdateNotifierInput {
  readonly notifierId: string;
  /** Written only if this is still the stored version. */
  readonly version: number;
  readonly name: string;
  readonly description?: string;
  readonly target: NotifierTarget;
  /** Absent keeps the stored credentials. */
  readonly credentials?: NotifierCredentials;
}

export interface UpdateNotifierOutput {
  /** Absent when no notifier holds that id and version, or another one holds the name; nothing was written. */
  readonly notifier?: Notifier;
}

export interface DeleteNotifierInput {
  readonly notifierId: string;
}

export interface DeleteNotifierOutput {
  readonly deleted: boolean;
  /** The monitors that kept it from being deleted, by name. Empty when it was deleted or did not exist. */
  readonly usedBy: ReadonlyArray<string>;
}

export interface ListDeliveryTargetsInput {
  readonly notifierIds: ReadonlyArray<string>;
}

export interface ListDeliveryTargetsOutput {
  /** Those of the ids that exist; one that does not is simply absent. */
  readonly targets: ReadonlyArray<DeliveryTarget>;
}

export interface NotifierDao {
  listNotifiers(input: ListNotifiersInput): Promise<ListNotifiersOutput>;
  getNotifier(input: GetNotifierInput): Promise<GetNotifierOutput>;
  createNotifier(input: CreateNotifierInput): Promise<CreateNotifierOutput>;
  updateNotifier(input: UpdateNotifierInput): Promise<UpdateNotifierOutput>;
  /** Refuses, deleting nothing, while any monitor sends to the notifier. */
  deleteNotifier(input: DeleteNotifierInput): Promise<DeleteNotifierOutput>;
  /** The one read that returns credentials, for sending and nothing else. */
  listDeliveryTargets(input: ListDeliveryTargetsInput): Promise<ListDeliveryTargetsOutput>;
}

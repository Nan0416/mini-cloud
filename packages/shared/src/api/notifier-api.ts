import { Notifier, NotifierTargetInput } from '../models/notifier';

export interface ListNotifiersRequest {}

export interface ListNotifiersResponse {
  /** By name. */
  readonly notifiers: ReadonlyArray<Notifier>;
}

export interface GetNotifierRequest {
  readonly notifierId: string;
}

export interface GetNotifierResponse {
  readonly notifier: Notifier;
}

/** Refused with a conflict when the name is taken. */
export interface CreateNotifierRequest {
  readonly name: string;
  readonly description?: string;
  readonly target: NotifierTargetInput;
}

export interface CreateNotifierResponse {
  readonly notifier: Notifier;
}

/** Replaces the whole notifier, and only if `version` is still the stored one. */
export interface UpdateNotifierRequest {
  readonly notifierId: string;
  /** The version this edit was made from. */
  readonly version: number;
  readonly name: string;
  readonly description?: string;
  readonly target: NotifierTargetInput;
}

export interface UpdateNotifierResponse {
  readonly notifier: Notifier;
}

/** Refused with a conflict while any monitor still sends to it. */
export interface DeleteNotifierRequest {
  readonly notifierId: string;
}

export interface DeleteNotifierResponse {}

/** Sends a sample message, so a notifier can be checked before anything relies on it. */
export interface TestNotifierRequest {
  readonly notifierId: string;
}

export interface TestNotifierResponse {}

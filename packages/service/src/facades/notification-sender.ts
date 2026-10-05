import { NotifierCredentials } from '../data/notifier-dao';
import { NotificationMessage } from '../utils/notification-message';

/**
 * Delivers a message to one kind of notifier. Rejects with a `DeliveryFailedError`
 * whose words say what to fix, and never with the credentials in them.
 */
export interface NotificationSender<C extends NotifierCredentials> {
  send(credentials: C, message: NotificationMessage): Promise<void>;
}

/** One sender per notifier type, so adding a type without a sender is a compile error. */
export type NotificationSenders = { readonly [T in NotifierCredentials['type']]: NotificationSender<Extract<NotifierCredentials, { type: T }>> };

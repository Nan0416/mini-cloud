import { LoggerFactory, NotFoundError } from '@mini-cloud/shared';
import { DeliveryTarget, NotifierDao } from '../data/notifier-dao';
import { NotificationMessage } from '../utils/notification-message';
import { NotificationSenders } from './notification-sender';

const logger = LoggerFactory.getLogger('NotificationDispatcher');

export interface NotificationDispatcherProps {
  readonly notifierDao: NotifierDao;
  readonly senders: NotificationSenders;
}

export interface DispatchInput {
  readonly notifierIds: ReadonlyArray<string>;
  readonly message: NotificationMessage;
}

export interface DispatchResult {
  readonly delivered: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<string>;
  /** Named, but no such notifier exists. */
  readonly missing: ReadonlyArray<string>;
}

/**
 * Sends a message to notifiers by id, choosing the sender by each one's type.
 *
 * Best-effort and not retried: every notifier is tried whatever happened to the
 * others, and a failure is logged rather than thrown, so the caller's own work — a
 * monitor's change of state, already recorded — is never undone by Discord being down.
 */
export class NotificationDispatcher {
  private readonly props: NotificationDispatcherProps;

  constructor(props: NotificationDispatcherProps) {
    this.props = props;
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    const { notifierIds, message } = input;
    if (notifierIds.length === 0) {
      return { delivered: [], failed: [], missing: [] };
    }

    let targets: ReadonlyArray<DeliveryTarget>;
    try {
      ({ targets } = await this.props.notifierDao.listDeliveryTargets({ notifierIds }));
    } catch (err) {
      logger.error(`"${message.title}" was not sent: its notifiers could not be read.`, err);
      return { delivered: [], failed: [...notifierIds], missing: [] };
    }

    const found = new Set(targets.map((target) => target.notifier.notifierId));
    const missing = notifierIds.filter((id) => !found.has(id));
    for (const id of missing) {
      logger.warn(`"${message.title}" was not sent to notifier ${id}: there is no such notifier.`);
    }

    const outcomes = await Promise.allSettled(targets.map((target) => this.sendTo(target, message)));
    const delivered: string[] = [];
    const failed: string[] = [];
    outcomes.forEach((outcome, index) => {
      const { notifier } = targets[index];
      if (outcome.status === 'fulfilled') {
        delivered.push(notifier.notifierId);
      } else {
        failed.push(notifier.notifierId);
        logger.error(`"${message.title}" could not be sent to notifier "${notifier.name}".`, outcome.reason);
      }
    });
    return { delivered, failed, missing };
  }

  /** Sends to one notifier now, and rejects with why when it cannot. */
  async deliver(notifierId: string, message: NotificationMessage): Promise<void> {
    const { targets } = await this.props.notifierDao.listDeliveryTargets({ notifierIds: [notifierId] });
    const target = targets[0];
    if (target === undefined) {
      throw new NotFoundError(`Notifier ${notifierId} does not exist; it may have been deleted.`);
    }
    await this.sendTo(target, message);
  }

  private async sendTo(target: DeliveryTarget, message: NotificationMessage): Promise<void> {
    const { notifier, credentials } = target;
    logger.info(`Sending "${message.title}" to notifier "${notifier.name}" (${credentials.type}).`);
    switch (credentials.type) {
      case 'discord':
        await this.props.senders.discord.send(credentials, message);
        return;
    }
  }
}

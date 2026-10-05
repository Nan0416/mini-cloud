import {
  ConflictError,
  CreateNotifierRequest,
  CreateNotifierResponse,
  DeleteNotifierRequest,
  DeleteNotifierResponse,
  GetNotifierRequest,
  GetNotifierResponse,
  InvalidRequestError,
  ListNotifiersRequest,
  ListNotifiersResponse,
  LoggerFactory,
  NotFoundError,
  Notifier,
  NotifierTarget,
  NotifierTargetInput,
  TestNotifierRequest,
  TestNotifierResponse,
  UpdateNotifierRequest,
  UpdateNotifierResponse,
  parseDiscordWebhookUrl,
} from '@mini-cloud/shared';
import { NotifierCredentials, NotifierDao } from '../data/notifier-dao';
import { NotificationDispatcher } from '../facades/notification-dispatcher';
import { generateNotifierId } from '../utils/ids';
import { testMessage } from '../utils/notification-message';

const logger = LoggerFactory.getLogger('NotifierService');

export interface NotifierServiceProps {
  readonly notifierDao: NotifierDao;
  readonly dispatcher: NotificationDispatcher;
  readonly now?: () => number;
}

/** A target as stored: what may be shown, and what may not. */
interface StoredTarget {
  readonly target: NotifierTarget;
  /** Absent when the input kept the stored credentials. */
  readonly credentials?: NotifierCredentials;
}

/**
 * Splits what a caller wrote into the part shown back and the credential. `current`
 * is the stored target, which an input without a new webhook URL keeps the webhook of.
 */
function toStored(input: NotifierTargetInput, current: NotifierTarget | undefined): StoredTarget {
  switch (input.type) {
    case 'discord': {
      if (input.webhookUrl === undefined) {
        if (current?.type !== 'discord') {
          throw new InvalidRequestError("target.webhookUrl is required for a new Discord notifier; copy it from the channel's Integrations → Webhooks.");
        }
        return { target: { type: input.type, channel: input.channel, webhookId: current.webhookId } };
      }
      const webhook = parseDiscordWebhookUrl(input.webhookUrl);
      if (webhook === undefined) {
        throw new InvalidRequestError('target.webhookUrl is not a Discord webhook URL.');
      }
      return {
        target: { type: input.type, channel: input.channel, webhookId: webhook.webhookId },
        credentials: { type: input.type, webhookUrl: input.webhookUrl },
      };
    }
  }
}

/** Notifiers: where messages can be sent, and a way to check one works. */
export class NotifierService {
  private readonly notifierDao: NotifierDao;
  private readonly dispatcher: NotificationDispatcher;
  private readonly now: () => number;

  constructor(props: NotifierServiceProps) {
    this.notifierDao = props.notifierDao;
    this.dispatcher = props.dispatcher;
    this.now = props.now ?? Date.now;
  }

  async listNotifiers(_request: ListNotifiersRequest = {}): Promise<ListNotifiersResponse> {
    const { notifiers } = await this.notifierDao.listNotifiers({});
    return { notifiers };
  }

  async getNotifier(request: GetNotifierRequest): Promise<GetNotifierResponse> {
    return { notifier: await this.require(request.notifierId) };
  }

  async createNotifier(request: CreateNotifierRequest): Promise<CreateNotifierResponse> {
    const { target, credentials } = toStored(request.target, undefined);
    if (credentials === undefined) {
      throw new InvalidRequestError('target.webhookUrl is required for a new notifier.');
    }
    const { notifier } = await this.notifierDao.createNotifier({ notifierId: generateNotifierId(), name: request.name, description: request.description, target, credentials });
    if (notifier === undefined) {
      throw new ConflictError(`A notifier called "${request.name}" already exists. Choose another name, or edit that one.`);
    }
    logger.info(`Created ${notifier.target.type} notifier "${notifier.name}" (${notifier.notifierId}).`);
    return { notifier };
  }

  async updateNotifier(request: UpdateNotifierRequest): Promise<UpdateNotifierResponse> {
    const current = await this.require(request.notifierId);
    const { target, credentials } = toStored(request.target, current.target);
    const { notifier } = await this.notifierDao.updateNotifier({
      notifierId: request.notifierId,
      version: request.version,
      name: request.name,
      description: request.description,
      target,
      credentials,
    });
    if (notifier !== undefined) {
      logger.info(`Saved notifier "${notifier.name}" (${notifier.notifierId}) as version ${notifier.version}${credentials === undefined ? '' : ', with a new webhook'}.`);
      return { notifier };
    }

    // Nothing written: it was deleted, someone saved it first, or the name is taken.
    const { notifier: latest } = await this.notifierDao.getNotifier({ notifierId: request.notifierId });
    if (latest === undefined) {
      throw new NotFoundError(`Notifier "${current.name}" does not exist any more; it was deleted while you were editing it.`);
    }
    if (latest.version !== request.version) {
      throw new ConflictError(
        `Notifier "${latest.name}" was saved elsewhere since version ${request.version}; it is at version ${latest.version} now. Reload it and make the edit again.`,
      );
    }
    throw new ConflictError(`Another notifier is already called "${request.name}". Choose another name.`);
  }

  async deleteNotifier(request: DeleteNotifierRequest): Promise<DeleteNotifierResponse> {
    const { deleted, usedBy } = await this.notifierDao.deleteNotifier({ notifierId: request.notifierId });
    if (deleted) {
      logger.info(`Deleted notifier ${request.notifierId}.`);
      return {};
    }
    if (usedBy.length > 0) {
      logger.warn(`Refused to delete notifier ${request.notifierId}: monitors [${usedBy.join(', ')}] still send to it.`);
      const monitors = usedBy.map((name) => `"${name}"`).join(', ');
      throw new ConflictError(
        usedBy.length === 1
          ? `This notifier is still used by monitor ${monitors}. Remove it from that monitor first.`
          : `This notifier is still used by monitors ${monitors}. Remove it from those monitors first.`,
      );
    }
    throw new NotFoundError(`Notifier ${request.notifierId} does not exist, so there is nothing to delete.`);
  }

  async testNotifier(request: TestNotifierRequest): Promise<TestNotifierResponse> {
    const notifier = await this.require(request.notifierId);
    await this.dispatcher.deliver(notifier.notifierId, testMessage(notifier.name, this.now()));
    logger.info(`Sent a test message to notifier "${notifier.name}".`);
    return {};
  }

  private async require(notifierId: string): Promise<Notifier> {
    const { notifier } = await this.notifierDao.getNotifier({ notifierId });
    if (notifier === undefined) {
      throw new NotFoundError(`Notifier ${notifierId} does not exist. List notifiers to see the ones there are.`);
    }
    return notifier;
  }
}

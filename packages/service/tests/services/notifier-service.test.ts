import { ConflictError, DeliveryFailedError, InvalidRequestError, LoggerFactory, Monitor, NotFoundError } from '@mini-cloud/shared';
import { DiscordCredentials } from '../../src/data/notifier-dao';
import { NotificationDispatcher } from '../../src/facades/notification-dispatcher';
import { NotificationSender } from '../../src/facades/notification-sender';
import { NotifierService } from '../../src/services/notifier-service';
import { NotificationMessage } from '../../src/utils/notification-message';
import { FakeMonitorDao, FakeNotifierDao } from '../data/fake-daos';

const URL = 'https://discord.com/api/webhooks/123/token';
const NEW_URL = 'https://discord.com/api/webhooks/456/other';

class RecordingSender implements NotificationSender<DiscordCredentials> {
  readonly sent: Array<{ webhookUrl: string; message: NotificationMessage }> = [];
  failWith: Error | undefined = undefined;

  async send({ webhookUrl }: DiscordCredentials, message: NotificationMessage): Promise<void> {
    if (this.failWith !== undefined) {
      throw this.failWith;
    }
    this.sent.push({ webhookUrl, message });
  }
}

const aMonitor = (notifierIds: ReadonlyArray<string>): Monitor => ({
  name: 'nas-cpu',
  metric: { namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: {}, statistic: 'avg' },
  periodMs: 300_000,
  evaluationPeriods: 1,
  datapointsToAlarm: 1,
  comparison: 'GreaterThanThreshold',
  threshold: 80,
  treatMissingData: 'missing',
  severity: 3,
  notify: true,
  notifierIds,
  state: 'OK',
  stateReason: 'fine',
  stateChangedAt: 0,
  version: 1,
  createdAt: 0,
  updatedAt: 0,
});

const context = () => {
  const monitorDao = new FakeMonitorDao();
  const notifierDao = new FakeNotifierDao(monitorDao);
  const sender = new RecordingSender();
  const dispatcher = new NotificationDispatcher({ notifierDao, senders: { discord: sender } });
  return { monitorDao, notifierDao, sender, service: new NotifierService({ notifierDao, dispatcher, now: () => 42 }) };
};

const create = (service: NotifierService, name = 'Alerts') => service.createNotifier({ name, target: { type: 'discord', channel: '#alerts', webhookUrl: URL } });

beforeAll(() => {
  jest.spyOn(LoggerFactory.getLogger('NotifierService'), 'warn').mockImplementation(() => {});
});

describe('NotifierService', () => {
  it('creates a notifier with an id of its own, showing the webhook’s id and keeping its URL to itself', async () => {
    const { notifierDao, service } = context();

    const { notifier } = await create(service);

    expect(notifier.notifierId).toMatch(/^ntf-/);
    expect(notifier.target).toEqual({ type: 'discord', channel: '#alerts', webhookId: '123' });
    expect(JSON.stringify(notifier)).not.toContain('token');
    expect(notifierDao.credentials.get(notifier.notifierId)).toEqual({ type: 'discord', webhookUrl: URL });
  });

  it('refuses a new notifier with no webhook URL, or a name that is taken', async () => {
    const { service } = context();
    await create(service);

    await expect(service.createNotifier({ name: 'Other', target: { type: 'discord', channel: '#alerts' } })).rejects.toThrow(InvalidRequestError);
    await expect(create(service)).rejects.toThrow(ConflictError);
  });

  it('renames a notifier and keeps its webhook when the edit brings none', async () => {
    const { notifierDao, service } = context();
    const { notifier } = await create(service);

    const { notifier: saved } = await service.updateNotifier({ notifierId: notifier.notifierId, version: 1, name: 'Home', target: { type: 'discord', channel: '#home' } });

    expect(saved).toMatchObject({ notifierId: notifier.notifierId, name: 'Home', target: { channel: '#home', webhookId: '123' }, version: 2 });
    expect(notifierDao.credentials.get(notifier.notifierId)).toEqual({ type: 'discord', webhookUrl: URL });
  });

  it('replaces the webhook when the edit brings a new URL', async () => {
    const { notifierDao, service } = context();
    const { notifier } = await create(service);

    const { notifier: saved } = await service.updateNotifier({
      notifierId: notifier.notifierId,
      version: 1,
      name: 'Alerts',
      target: { type: 'discord', channel: '#alerts', webhookUrl: NEW_URL },
    });

    expect(saved.target).toMatchObject({ webhookId: '456' });
    expect(notifierDao.credentials.get(notifier.notifierId)).toEqual({ type: 'discord', webhookUrl: NEW_URL });
  });

  it('tells a stale edit from a rename onto a taken name, and both from a deleted notifier', async () => {
    const { service } = context();
    const { notifier } = await create(service);
    await create(service, 'Pager');
    await service.updateNotifier({ notifierId: notifier.notifierId, version: 1, name: 'Alerts', target: { type: 'discord', channel: '#a' } });

    await expect(service.updateNotifier({ notifierId: notifier.notifierId, version: 1, name: 'Alerts', target: { type: 'discord', channel: '#b' } })).rejects.toThrow(
      /saved elsewhere since version 1/,
    );
    await expect(service.updateNotifier({ notifierId: notifier.notifierId, version: 2, name: 'Pager', target: { type: 'discord', channel: '#b' } })).rejects.toThrow(
      /already called "Pager"/,
    );
    await expect(service.updateNotifier({ notifierId: 'ntf-gone', version: 1, name: 'X', target: { type: 'discord', channel: '#b' } })).rejects.toThrow(NotFoundError);
  });

  it('refuses to delete a notifier a monitor sends to, and names the monitor', async () => {
    const { monitorDao, service } = context();
    const { notifier } = await create(service);
    monitorDao.seed(aMonitor([notifier.notifierId]));

    await expect(service.deleteNotifier({ notifierId: notifier.notifierId })).rejects.toThrow(/still used by monitor "nas-cpu"/);
    monitorDao.monitors.clear();
    await service.deleteNotifier({ notifierId: notifier.notifierId });
    await expect(service.getNotifier({ notifierId: notifier.notifierId })).rejects.toThrow(NotFoundError);
    await expect(service.deleteNotifier({ notifierId: notifier.notifierId })).rejects.toThrow(NotFoundError);
  });

  it('sends a test message that says so, and passes on why when Discord refuses it', async () => {
    const { sender, service } = context();
    const { notifier } = await create(service);

    await service.testNotifier({ notifierId: notifier.notifierId });
    sender.failWith = new DeliveryFailedError('Discord has no such webhook.');

    expect(sender.sent).toEqual([{ webhookUrl: URL, message: expect.objectContaining({ title: 'mini-cloud test message', timestamp: 42 }) }]);
    await expect(service.testNotifier({ notifierId: notifier.notifierId })).rejects.toThrow(DeliveryFailedError);
    await expect(service.testNotifier({ notifierId: 'ntf-gone' })).rejects.toThrow(NotFoundError);
  });
});

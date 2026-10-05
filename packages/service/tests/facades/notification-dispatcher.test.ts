import { LoggerFactory, NotFoundError } from '@mini-cloud/shared';
import { DiscordCredentials } from '../../src/data/notifier-dao';
import { NotificationDispatcher } from '../../src/facades/notification-dispatcher';
import { NotificationSender } from '../../src/facades/notification-sender';
import { NotificationMessage } from '../../src/utils/notification-message';
import { FakeNotifierDao, aNotifier } from '../data/fake-daos';

const MESSAGE: NotificationMessage = { title: 'nas-cpu is OK', body: 'All good.', tone: 'resolved', fields: [], timestamp: 0 };

class RecordingSender implements NotificationSender<DiscordCredentials> {
  readonly sent: string[] = [];
  readonly failing = new Set<string>();

  async send({ webhookUrl }: DiscordCredentials): Promise<void> {
    if (this.failing.has(webhookUrl)) {
      throw new Error('discord is down');
    }
    this.sent.push(webhookUrl);
  }
}

const context = () => {
  const notifierDao = new FakeNotifierDao()
    .seed(aNotifier({ notifierId: 'ntf-a', name: 'A' }), { type: 'discord', webhookUrl: 'url-a' })
    .seed(aNotifier({ notifierId: 'ntf-b', name: 'B' }), { type: 'discord', webhookUrl: 'url-b' });
  const sender = new RecordingSender();
  return { notifierDao, sender, dispatcher: new NotificationDispatcher({ notifierDao, senders: { discord: sender } }) };
};

beforeAll(() => {
  jest.spyOn(LoggerFactory.getLogger('NotificationDispatcher'), 'error').mockImplementation(() => {});
  jest.spyOn(LoggerFactory.getLogger('NotificationDispatcher'), 'warn').mockImplementation(() => {});
});

describe('NotificationDispatcher', () => {
  it('sends to every notifier named, with its own credentials', async () => {
    const { sender, dispatcher } = context();

    const result = await dispatcher.dispatch({ notifierIds: ['ntf-a', 'ntf-b'], message: MESSAGE });

    expect(sender.sent.sort()).toEqual(['url-a', 'url-b']);
    expect(result).toEqual({ delivered: ['ntf-a', 'ntf-b'], failed: [], missing: [] });
  });

  it('reports a failed or missing notifier without stopping the rest, and never throws', async () => {
    const { sender, dispatcher } = context();
    sender.failing.add('url-a');

    const result = await dispatcher.dispatch({ notifierIds: ['ntf-a', 'ntf-gone', 'ntf-b'], message: MESSAGE });

    expect(sender.sent).toEqual(['url-b']);
    expect(result).toEqual({ delivered: ['ntf-b'], failed: ['ntf-a'], missing: ['ntf-gone'] });
  });

  it('counts every notifier failed when they cannot be read, and still does not throw', async () => {
    const { notifierDao, dispatcher } = context();
    notifierDao.listDeliveryTargets = async () => {
      throw new Error('connection reset');
    };

    await expect(dispatcher.dispatch({ notifierIds: ['ntf-a'], message: MESSAGE })).resolves.toEqual({ delivered: [], failed: ['ntf-a'], missing: [] });
  });

  it('delivers to one notifier on demand, and rejects with why when it cannot', async () => {
    const { sender, dispatcher } = context();
    sender.failing.add('url-b');

    await dispatcher.deliver('ntf-a', MESSAGE);
    await expect(dispatcher.deliver('ntf-b', MESSAGE)).rejects.toThrow('discord is down');
    await expect(dispatcher.deliver('ntf-gone', MESSAGE)).rejects.toThrow(NotFoundError);
    expect(sender.sent).toEqual(['url-a']);
  });
});

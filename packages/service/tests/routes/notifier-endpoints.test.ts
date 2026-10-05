import { CreateNotifierResponse, ErrorResponse, GetNotifierResponse, ListNotifiersResponse, LoggerFactory, UpdateNotifierResponse } from '@mini-cloud/shared';
import { DiscordCredentials } from '../../src/data/notifier-dao';
import { NotificationDispatcher } from '../../src/facades/notification-dispatcher';
import { NotificationSender } from '../../src/facades/notification-sender';
import { NotifierEndpoints } from '../../src/routes/notifier-endpoints';
import { NotifierService } from '../../src/services/notifier-service';
import { DeliveryFailedError } from '@mini-cloud/shared';
import { FakeMonitorDao, FakeNotifierDao } from '../data/fake-daos';
import { TestServer } from './test-helpers';

const URL = 'https://discord.com/api/webhooks/123/token';

class RefusingSender implements NotificationSender<DiscordCredentials> {
  async send(): Promise<void> {
    throw new DeliveryFailedError('Discord has no such webhook (HTTP 404: Unknown Webhook).');
  }
}

let server: TestServer;

beforeAll(() => {
  jest.spyOn(LoggerFactory.getLogger('ErrorHandler'), 'warn').mockImplementation(() => {});
});

beforeEach(async () => {
  const notifierDao = new FakeNotifierDao(new FakeMonitorDao());
  const dispatcher = new NotificationDispatcher({ notifierDao, senders: { discord: new RefusingSender() } });
  server = await TestServer.start(new NotifierEndpoints({ notifierService: new NotifierService({ notifierDao, dispatcher }) }));
});

afterEach(async () => {
  await server.close();
});

const create = () => server.post<CreateNotifierResponse>('/notifiers', { name: 'Alerts', target: { type: 'discord', channel: '#alerts', webhookUrl: URL } });

describe('notifier routes', () => {
  it('creates a notifier and serves it at its id, never with its webhook URL', async () => {
    const created = await create();
    const read = await server.get<GetNotifierResponse>(`/notifiers/${created.body.notifier.notifierId}`);
    const listed = await server.get<ListNotifiersResponse>('/notifiers');

    expect(created.status).toBe(201);
    expect(read.body.notifier).toEqual(created.body.notifier);
    expect(listed.body.notifiers).toEqual([created.body.notifier]);
    expect(JSON.stringify([created.body, read.body, listed.body])).not.toContain('token');
  });

  it('takes the id from the path on an update', async () => {
    const created = await create();
    const id = created.body.notifier.notifierId;

    const saved = await server.put<UpdateNotifierResponse>(`/notifiers/${id}`, {
      notifierId: 'ntf-other',
      version: 1,
      name: 'Home',
      target: { type: 'discord', channel: '#home' },
    });

    expect(saved.status).toBe(200);
    expect(saved.body.notifier).toMatchObject({ notifierId: id, name: 'Home' });
  });

  it('answers 400 for a URL that is not a Discord webhook', async () => {
    const response = await server.post<ErrorResponse>('/notifiers', { name: 'Alerts', target: { type: 'discord', channel: '#alerts', webhookUrl: 'https://example.com/hook' } });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('target.webhookUrl');
  });

  it('answers 502 with Discord’s reason when a test message is refused', async () => {
    const created = await create();

    const response = await server.post<ErrorResponse>(`/notifiers/${created.body.notifier.notifierId}/test`);

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: 'Discord has no such webhook (HTTP 404: Unknown Webhook).', errorCode: 'DELIVERY_FAILED' });
  });

  it('deletes a notifier nothing uses, and answers 404 after', async () => {
    const created = await create();
    const path = `/notifiers/${created.body.notifier.notifierId}`;

    const deleted = await server.delete(path);
    const again = await server.delete<ErrorResponse>(path);

    expect(deleted.status).toBe(200);
    expect(again.status).toBe(404);
  });
});

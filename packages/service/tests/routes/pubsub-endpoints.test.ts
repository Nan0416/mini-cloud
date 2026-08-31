import { BroadcastResponse, ErrorResponse, GetHubStatusResponse, HubStatus, SendToResponse, Target } from '@mini-cloud/shared';
import { MessageHub, OutboundMessage } from '../../src/facades/message-hub';
import { PubSubEndpoints } from '../../src/routes/pubsub-endpoints';
import { TestServer } from './test-helpers';

class FakeHub implements MessageHub {
  readonly published: Array<{ target: Target; message: OutboundMessage }> = [];
  deliveredTo = 1;
  status: HubStatus = { subscriberCount: 0, topicToSubscriberCount: {} };

  publish(target: Target, message: OutboundMessage): number {
    this.published.push({ target, message });
    return this.deliveredTo;
  }

  getStatus(): HubStatus {
    return this.status;
  }

  async terminate(): Promise<void> {}
}

let hub: FakeHub;
let server: TestServer;

beforeEach(async () => {
  hub = new FakeHub();
  server = await TestServer.start(new PubSubEndpoints({ messageHub: hub }));
});

afterEach(async () => {
  await server.close();
});

const message = { publishedAt: 1_700_000_000_000, payload: { build: 'ok' } };

describe('POST /pubsub/broadcast', () => {
  it('publishes to the topic and reports the delivery count', async () => {
    hub.deliveredTo = 3;

    const response = await server.post<BroadcastResponse>('/pubsub/broadcast', { topic: 'builds', ...message });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deliveredTo: 3 });
    expect(hub.published[0]?.target).toEqual({ method: 'broadcast', to: 'builds' });
  });

  it("keeps the publisher's own timestamp, so latency is measurable end to end", async () => {
    await server.post('/pubsub/broadcast', { topic: 'builds', ...message });

    // Restamping here would make `forwardedAt - publishedAt` always zero.
    expect(hub.published[0]?.message).toMatchObject({ publishedAt: 1_700_000_000_000, payload: { build: 'ok' } });
  });

  it('publishes anonymously, because an HTTP caller holds no connection', async () => {
    await server.post('/pubsub/broadcast', { topic: 'builds', ...message });

    expect(hub.published[0]?.message.senderId).toBeUndefined();
  });

  it('answers 200 with zero when nobody is subscribed', async () => {
    hub.deliveredTo = 0;

    const response = await server.post<BroadcastResponse>('/pubsub/broadcast', { topic: 'builds', ...message });

    // An empty topic is not an error: subscribers come and go, and the count is the
    // news the caller acts on.
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deliveredTo: 0 });
  });

  it('answers 400 when a publisher tries to name itself', async () => {
    const response = await server.post<ErrorResponse>('/pubsub/broadcast', { topic: 'builds', ...message, senderId: 'someone-else' });

    // Rejected rather than ignored: a publisher that set it and got a 200 back would
    // reasonably believe recipients see it as the sender.
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/senderId cannot be set by a publisher/);
    expect(hub.published).toEqual([]);
  });

  it('answers 400 for a message with no topic or no payload', async () => {
    expect((await server.post('/pubsub/broadcast', message)).status).toBe(400);
    expect((await server.post('/pubsub/broadcast', { topic: 'builds', publishedAt: 1 })).status).toBe(400);
  });
});

describe('POST /pubsub/p2p', () => {
  it('addresses the named subscriber', async () => {
    const response = await server.post<SendToResponse>('/pubsub/p2p', { recipientId: 'sub-1', ...message });

    expect(response.status).toBe(200);
    expect(hub.published[0]?.target).toEqual({ method: 'p2p', to: 'sub-1' });
  });

  it('answers 200 with zero for a recipient that has disconnected', async () => {
    hub.deliveredTo = 0;

    const response = await server.post<SendToResponse>('/pubsub/p2p', { recipientId: 'gone', ...message });

    // Not a 404: subscribers come and go, so an absent one is news for the caller to
    // act on rather than a malformed request.
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deliveredTo: 0 });
  });

  it('answers 400 when a publisher tries to name itself', async () => {
    expect((await server.post('/pubsub/p2p', { recipientId: 'sub-1', ...message, senderId: 'x' })).status).toBe(400);
  });

  it('answers 400 with no recipient', async () => {
    expect((await server.post('/pubsub/p2p', message)).status).toBe(400);
  });
});

describe('GET /pubsub/status', () => {
  it("reports the hub's subscriber counts", async () => {
    hub.status = { subscriberCount: 2, topicToSubscriberCount: { 'mini-cloud.agents': 2 } };

    const response = await server.get<GetHubStatusResponse>('/pubsub/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: { subscriberCount: 2, topicToSubscriberCount: { 'mini-cloud.agents': 2 } } });
  });

  it('reports an idle hub rather than failing', async () => {
    const response = await server.get<GetHubStatusResponse>('/pubsub/status');

    expect(response.body.status).toEqual({ subscriberCount: 0, topicToSubscriberCount: {} });
  });
});

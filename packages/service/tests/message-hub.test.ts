import { EventEnvelope, HubMessage } from '@mini-cloud/shared';
import { AddressInfo } from 'node:net';
import { createServer, Server } from 'node:http';
import { WebSocket } from 'ws';
import { WsMessageHub } from '../src/facades/message-hub';

/**
 * Exercises the hub over real sockets.
 *
 * Delivery is the whole job here, and it is the part a mocked socket cannot check:
 * whether a message reached exactly the right connections, and whether the metadata
 * a recipient reads back is the metadata the sender actually set. Both indexes and
 * the frame encoding are in the path, so this runs the real thing on a loopback
 * port — no database, so it always runs.
 */

/** A connected client that records everything the hub sends it. */
class TestClient {
  readonly received: HubMessage[] = [];
  private readonly socket: WebSocket;
  private welcomed?: string;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (data) => {
      const message: HubMessage = JSON.parse(data.toString());
      if (message.type === 'welcome') {
        this.welcomed = message.subscriberId;
      }
      this.received.push(message);
    });
  }

  static async connect(port: number): Promise<TestClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const client = new TestClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.on('open', () => resolve());
      socket.on('error', reject);
    });
    await client.waitFor(() => client.welcomed !== undefined);
    return client;
  }

  get id(): string {
    if (this.welcomed === undefined) {
      throw new Error('The hub has not assigned this client an id yet.');
    }
    return this.welcomed;
  }

  get events(): EventEnvelope[] {
    return this.received.filter((message) => message.type === 'event').map((message) => message.envelope);
  }

  send(request: unknown): void {
    this.socket.send(JSON.stringify(request));
  }

  /** Polls rather than sleeps a fixed time, so a slow machine waits and a fast one does not. */
  async waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      if (Date.now() > deadline) {
        throw new Error('Timed out waiting for the hub.');
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  /** Gives the hub a round trip to deliver anything it was going to deliver. */
  async settle(): Promise<void> {
    const before = this.received.length;
    this.send({ action: 'ping' });
    await this.waitFor(() => this.received.length > before);
  }

  close(): void {
    this.socket.close();
  }
}

describe('WsMessageHub', () => {
  let server: Server;
  let hub: WsMessageHub;
  let port: number;
  const clients: TestClient[] = [];

  beforeEach(async () => {
    server = createServer();
    hub = new WsMessageHub({ server });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address: AddressInfo | string | null = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected the test server to be listening on a TCP port.');
    }
    port = address.port;
  });

  afterEach(async () => {
    for (const client of clients) {
      client.close();
    }
    clients.length = 0;
    await hub.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function connect(): Promise<TestClient> {
    const client = await TestClient.connect(port);
    clients.push(client);
    return client;
  }

  async function subscribe(client: TestClient, topic: string): Promise<void> {
    client.send({ action: 'subscribe', topic });
    await client.waitFor(() => client.received.some((message) => message.type === 'ack' && message.action === 'subscribe' && message.to === topic));
  }

  it('gives every connection a distinct id it can be addressed by', async () => {
    const first = await connect();
    const second = await connect();
    expect(first.id).not.toEqual(second.id);
  });

  it('delivers a broadcast to every subscriber of the topic and to nobody else', async () => {
    const listenerA = await connect();
    const listenerB = await connect();
    const bystander = await connect();
    await subscribe(listenerA, 'weather');
    await subscribe(listenerB, 'weather');
    await subscribe(bystander, 'sports');

    const deliveredTo = hub.publish({ method: 'broadcast', to: 'weather' }, { payload: { temp: 21 }, publishedAt: 1_000 });

    expect(deliveredTo).toBe(2);
    await listenerA.waitFor(() => listenerA.events.length === 1);
    await listenerB.waitFor(() => listenerB.events.length === 1);
    expect(listenerA.events[0].payload).toEqual({ temp: 21 });
    expect(listenerA.events[0].target).toEqual({ method: 'broadcast', to: 'weather' });
    await bystander.settle();
    expect(bystander.events).toHaveLength(0);
  });

  it('delivers a p2p message only to the named recipient, without it subscribing to anything', async () => {
    const recipient = await connect();
    const bystander = await connect();
    await subscribe(bystander, 'weather');

    const deliveredTo = hub.publish({ method: 'p2p', to: recipient.id }, { payload: 'hello', publishedAt: 1_000 });

    expect(deliveredTo).toBe(1);
    await recipient.waitFor(() => recipient.events.length === 1);
    expect(recipient.events[0].payload).toBe('hello');
    expect(recipient.events[0].target).toEqual({ method: 'p2p', to: recipient.id });
    await bystander.settle();
    expect(bystander.events).toHaveLength(0);
  });

  it('reports zero deliveries for a recipient that is not connected', async () => {
    expect(hub.publish({ method: 'p2p', to: 'nobody-by-that-name' }, { payload: 'hello', publishedAt: 1_000 })).toBe(0);
  });

  it('reports zero deliveries for a topic nobody is listening to', async () => {
    expect(hub.publish({ method: 'broadcast', to: 'empty' }, { payload: 'hello', publishedAt: 1_000 })).toBe(0);
  });

  it('preserves the publisher timestamp and stamps its own forwarding time', async () => {
    const listener = await connect();
    await subscribe(listener, 'weather');
    const publishedAt = Date.now() - 5_000;

    hub.publish({ method: 'broadcast', to: 'weather' }, { payload: {}, publishedAt });

    await listener.waitFor(() => listener.events.length === 1);
    // The publisher's own stamp survives untouched, which is what makes the gap
    // between the two a latency rather than always zero.
    expect(listener.events[0].publishedAt).toBe(publishedAt);
    expect(listener.events[0].forwardedAt).toBeGreaterThanOrEqual(publishedAt + 5_000);
  });

  it('attributes a message to the connection it arrived on', async () => {
    const sender = await connect();
    const listener = await connect();
    await subscribe(listener, 'weather');

    sender.send({ action: 'broadcast', topic: 'weather', publishedAt: Date.now(), payload: { temp: 21 } });

    await listener.waitFor(() => listener.events.length === 1);
    expect(listener.events[0].senderId).toBe(sender.id);
  });

  it('ignores a sender id a publisher tries to set for itself', async () => {
    const sender = await connect();
    const listener = await connect();
    await subscribe(listener, 'weather');

    sender.send({ action: 'broadcast', topic: 'weather', publishedAt: Date.now(), payload: {}, senderId: 'someone-else' });

    await listener.waitFor(() => listener.events.length === 1);
    expect(listener.events[0].senderId).toBe(sender.id);
  });

  it('lets a recipient reply to whoever sent it a message', async () => {
    const alice = await connect();
    const bob = await connect();
    await subscribe(bob, 'weather');

    alice.send({ action: 'broadcast', topic: 'weather', publishedAt: Date.now(), payload: 'ping' });
    await bob.waitFor(() => bob.events.length === 1);

    // The whole point of attribution: bob knows nothing about alice except the id he
    // read off the envelope, and that is enough to reach her.
    bob.send({ action: 'p2p', recipientId: bob.events[0].senderId, publishedAt: Date.now(), payload: 'pong' });

    await alice.waitFor(() => alice.events.length === 1);
    expect(alice.events[0].payload).toBe('pong');
    expect(alice.events[0].senderId).toBe(bob.id);
  });

  it('publishes anonymously when the hub is the publisher', async () => {
    const listener = await connect();
    await subscribe(listener, 'weather');

    hub.publish({ method: 'broadcast', to: 'weather' }, { payload: {}, publishedAt: Date.now() });

    await listener.waitFor(() => listener.events.length === 1);
    expect(listener.events[0].senderId).toBeUndefined();
  });

  it('rejects a publish carrying no timestamp instead of inventing one', async () => {
    const sender = await connect();

    sender.send({ action: 'broadcast', topic: 'weather', payload: {} });

    await sender.waitFor(() => sender.received.some((message) => message.type === 'error'));
    const error = sender.received.find((message) => message.type === 'error');
    expect(error).toEqual({ type: 'error', message: 'publishedAt must be a number' });
  });

  it('rejects a p2p request that names no recipient', async () => {
    const sender = await connect();

    sender.send({ action: 'p2p', publishedAt: Date.now(), payload: {} });

    await sender.waitFor(() => sender.received.some((message) => message.type === 'error'));
    const error = sender.received.find((message) => message.type === 'error');
    expect(error).toEqual({ type: 'error', message: 'recipientId must be a string' });
  });

  it('tells a publisher how many subscribers its message reached', async () => {
    const sender = await connect();
    const listener = await connect();
    await subscribe(listener, 'weather');

    sender.send({ action: 'broadcast', topic: 'weather', publishedAt: Date.now(), payload: {} });

    await sender.waitFor(() => sender.received.some((message) => message.type === 'ack' && message.action === 'broadcast'));
    const ack = sender.received.find((message) => message.type === 'ack' && message.action === 'broadcast');
    expect(ack).toEqual({ type: 'ack', action: 'broadcast', to: 'weather', deliveredTo: 1 });
  });

  it('stops counting a subscriber once it disconnects', async () => {
    const listener = await connect();
    await subscribe(listener, 'weather');
    expect(hub.getStatus()).toEqual({ subscriberCount: 1, topicToSubscriberCount: { weather: 1 } });

    listener.close();
    // The close is observed on the server side, so poll the hub rather than the client.
    const deadline = Date.now() + 2_000;
    while (hub.getStatus().subscriberCount > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(hub.getStatus()).toEqual({ subscriberCount: 0, topicToSubscriberCount: {} });
    expect(hub.publish({ method: 'p2p', to: listener.id }, { payload: {}, publishedAt: Date.now() })).toBe(0);
  });
});

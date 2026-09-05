import { HubStatus, Target } from '@mini-cloud/shared';
import { DependencyFactory } from '../../src/dependencies/dependency-factory';
import { MessageHub, OutboundMessage } from '../../src/facades/message-hub';
import { Service } from '../../src/service';
import { ServiceConfig } from '../../src/stage-config';
import { FakePool } from '../data/test-helpers';
import { TestServer } from '../routes/test-helpers';

/**
 * What is reachable from where.
 *
 * This is the one property the two-listener split exists to hold, and the one that
 * breaks silently: a route added to the wrong endpoint group still compiles, still
 * passes its own test, and is simply also answering on the port that faces the
 * internet. So the matrix is asserted in both directions — every route is served by
 * exactly one listener, and 404 on the other.
 */

class FakeHub implements MessageHub {
  publish(_target: Target, _message: OutboundMessage): number {
    return 0;
  }
  getStatus(): HubStatus {
    return { subscriberCount: 0, topicToSubscriberCount: {} };
  }
  async terminate(): Promise<void> {}
}

const aConfig = (overrides: Partial<ServiceConfig> = {}): ServiceConfig => ({
  stage: 'beta',
  databaseUrl: 'postgres://localhost:5432/mini_cloud_test',
  internal: { host: '127.0.0.1', port: 3000, trustedSubnets: ['127.0.0.0/8'] },
  public: { host: '127.0.0.1', port: 3001, corsOrigins: ['*'] },
  consoleUrl: '',
  scheduler: {
    jobTickMs: 1_000,
    maintenanceTickMs: 5_000,
    agentOfflineAfterMs: 15_000,
    launchTimeoutMs: 15_000,
    startTimeoutMs: 60_000,
    retentionDays: 365,
    retentionTickMs: 3600_000,
  },
  ...overrides,
});

interface Listeners {
  readonly internal: TestServer;
  readonly public: TestServer;
  readonly close: () => Promise<void>;
}

const start = async (config: ServiceConfig = aConfig()): Promise<Listeners> => {
  const dependencies = new DependencyFactory({ config, pool: new FakePool().asPool(), messageHub: new FakeHub() }).build();
  const build = (name: 'internal' | 'public'): ReturnType<Service['init']> =>
    new Service({
      name,
      middleware: dependencies[name].middleware,
      endpoints: dependencies[name].endpoints,
      notFound: dependencies[name].notFound,
      errorHandler: dependencies.errorHandler,
    }).init();

  const internal = await TestServer.startApp(build('internal'));
  const publicListener = await TestServer.startApp(build('public'));
  return {
    internal,
    public: publicListener,
    close: async () => {
      await Promise.all([internal.close(), publicListener.close()]);
    },
  };
};

/**
 * Probes are chosen to stop at the routing layer: a GET that reads an empty table, or
 * a POST with a body the parser rejects. Either way the answer distinguishes "this
 * listener serves the path" from 404, without a request reaching Postgres.
 */
const ROUTES: ReadonlyArray<{ method: 'GET' | 'POST'; path: string; internal: boolean; public: boolean }> = [
  { method: 'GET', path: '/ping', internal: true, public: true },
  { method: 'GET', path: '/health', internal: true, public: true },
  { method: 'POST', path: '/agent-api/heartbeat', internal: true, public: false },
  { method: 'POST', path: '/agent-api/instance-status', internal: true, public: false },
  { method: 'POST', path: '/agent-api/instance-pid', internal: true, public: false },
  { method: 'POST', path: '/agent-api/instance-event', internal: true, public: false },
  { method: 'POST', path: '/agent-api/instances', internal: true, public: false },
  { method: 'POST', path: '/agent-api/health-checks', internal: true, public: false },
  { method: 'GET', path: '/pubsub/status', internal: true, public: true },
  { method: 'POST', path: '/pubsub/broadcast', internal: true, public: true },
  { method: 'POST', path: '/pubsub/p2p', internal: true, public: true },
  { method: 'GET', path: '/tasks', internal: false, public: true },
  { method: 'POST', path: '/tasks', internal: false, public: true },
  { method: 'GET', path: '/instances', internal: false, public: true },
  { method: 'GET', path: '/agents', internal: false, public: true },
  { method: 'GET', path: '/variables', internal: false, public: true },
];

let listeners: Listeners;

afterEach(async () => {
  await listeners.close();
});

describe('which listener serves what', () => {
  it.each(ROUTES)('serves $method $path on the listeners it belongs to', async (route) => {
    listeners = await start();

    const onInternal = await listeners.internal.request(route.method, route.path, route.method === 'POST' ? {} : undefined);
    const onPublic = await listeners.public.request(route.method, route.path, route.method === 'POST' ? {} : undefined);

    expect(onInternal.status === 404).toBe(!route.internal);
    expect(onPublic.status === 404).toBe(!route.public);
  });

  it('keeps agent reports off the listener a port forward points at', async () => {
    listeners = await start();

    // The single most consequential line of the split: an agent's report path, and
    // with it the topics that command agents, must not be reachable from outside.
    const response = await listeners.public.post('/agent-api/heartbeat', { agentId: 'mac-mini', name: 'Mac mini' });

    expect(response.status).toBe(404);
  });

  it('tells a caller which listener does serve the path it asked for', async () => {
    listeners = await start();

    const response = await listeners.internal.get<{ error: string }>('/tasks');

    expect(response.body.error).toContain('public listener (port 3001)');
  });
});

describe('what runs before the routes', () => {
  it('answers no CORS header on the internal listener, whatever origin asks', async () => {
    listeners = await start();

    // A page the operator visits can send a request here; this is what stops it
    // reading the answer — and the reason the internal listener installs no CORS at
    // all, rather than a narrowed allow-list.
    const response = await fetch(`${listeners.internal.origin}/ping`, { headers: { origin: 'https://evil.example.com' } });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers a CORS header on the public listener, which the console needs', async () => {
    listeners = await start();

    const response = await fetch(`${listeners.public.origin}/ping`, { headers: { origin: 'https://console.example.com' } });

    expect(response.headers.get('access-control-allow-origin')).toBe('https://console.example.com');
  });

  it('lets each listener demand its own token, or none', async () => {
    // The arrangement this is built for: agents on the LAN need no secret, while the
    // listener that faces the internet refuses anything without one.
    const config = aConfig();
    listeners = await start({ ...config, public: { ...config.public, authToken: 'operator' } });

    expect((await listeners.public.get('/tasks')).status).toBe(401);
    expect((await listeners.internal.post('/agent-api/heartbeat', {})).status).toBe(400);
  });
});

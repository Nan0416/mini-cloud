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
  databaseUrl: 'postgres://localhost:5432/mini_cloud_test',
  internal: { host: '127.0.0.1', port: 3000, trustedSubnets: ['127.0.0.0/8'] },
  // A token, because the public listener will not be built without one. The internal
  // listener has no equivalent field: the source address is what guards it.
  public: { host: '127.0.0.1', port: 3001, corsOrigins: ['*'], authToken: 'operator' },
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

/** The token `aConfig` gives the public listener, which every probe of it must carry. */
const AUTHORIZED = { authorization: 'Bearer operator' };

/**
 * Probes are chosen to stop at the routing layer: a GET that reads an empty table, or
 * a POST with a body the parser rejects. Either way the answer distinguishes "this
 * listener serves the path" from 404, without a request reaching Postgres.
 *
 * The public ones authenticate, because that listener answers 401 before it routes —
 * so an unauthenticated probe cannot tell a path it does not serve from one it does.
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

    const body = route.method === 'POST' ? {} : undefined;
    const onInternal = await listeners.internal.request(route.method, route.path, body);
    const onPublic = await listeners.public.request(route.method, route.path, body, AUTHORIZED);

    expect(onInternal.status === 404).toBe(!route.internal);
    expect(onPublic.status === 404).toBe(!route.public);
  });

  it('keeps agent reports off the listener a port forward points at', async () => {
    listeners = await start();

    // The single most consequential line of the split: an agent's report path, and
    // with it the topics that command agents, must not be reachable from outside.
    const response = await listeners.public.post('/agent-api/heartbeat', { agentId: 'mac-mini', name: 'Mac mini' }, AUTHORIZED);

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

  it('answers 401 before routing, so an unauthenticated caller learns no paths', async () => {
    listeners = await start();

    // Even for a path it does not serve. Ordering auth after the routes would let
    // anyone map the API by reading which paths 404 and which do not.
    expect((await listeners.public.get('/agent-api/nonsense')).status).toBe(401);
    expect((await listeners.public.get('/agent-api/nonsense', AUTHORIZED)).status).toBe(404);
  });

  it('demands a token on the public listener and none on the internal one', async () => {
    // The arrangement this is built for: agents on the LAN present no secret and are
    // admitted by address, while the listener that faces the internet refuses anything
    // without a token. The 400 is the agent route being reached and rejecting an empty
    // body — which is the point, since a 401 would mean it had asked for a credential.
    listeners = await start();

    expect((await listeners.public.get('/tasks')).status).toBe(401);
    expect((await listeners.internal.post('/agent-api/heartbeat', {})).status).toBe(400);
  });

  it('refuses to build a public listener with no token at all', async () => {
    const config = aConfig();

    // Enforced here rather than when the environment is read: `config` resolves at
    // import and the CLI imports it for every command, so a required read there makes
    // `mini-cloud task list` die on a missing variable before parsing an argument.
    expect(() =>
      new DependencyFactory({ config: { ...config, public: { ...config.public, authToken: undefined } }, pool: new FakePool().asPool(), messageHub: new FakeHub() }).build(),
    ).toThrow(/MINI_CLOUD_PUBLIC_TOKEN is not set/);

    listeners = await start();
  });
});

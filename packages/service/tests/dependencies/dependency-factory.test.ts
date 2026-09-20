import { HubStatus, LoggerFactory, Target } from '@mini-cloud/shared';
import { DependencyFactory } from '../../src/dependencies/dependency-factory';
import { MessageHub, OutboundMessage } from '../../src/facades/message-hub';
import { Service } from '../../src/service';
import { DEFAULT_PUBLIC_TOKEN, ServiceConfig } from '../../src/config';
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
  // A token of its own, rather than the default one `loadConfig` falls back to: these cases are
  // about what each listener serves, and running them on the default would put a warning nobody
  // is asserting on in the middle of it.
  public: { host: '127.0.0.1', port: 3001, corsOrigins: ['*'], authToken: 'operator' },
  consoleUrl: '',
  // Where the CLI would point. Nothing in this file drives the CLI, but the shape is
  // one object and a partial one would not typecheck.
  cli: { serviceUrl: 'http://127.0.0.1:3001', internalUrl: 'http://127.0.0.1:3000' },
  // Read on a worker machine; nothing in this file drives an agent.
  agent: {},
  scheduler: {
    jobTickMs: 1_000,
    maintenanceTickMs: 5_000,
    agentOfflineAfterMs: 15_000,
    launchTimeoutMs: 15_000,
    startTimeoutMs: 60_000,
    retentionDays: 365,
    retentionTickMs: 3600_000,
  },
  metrics: {
    rawRetentionDays: 14,
    rollupRetentionDays: 400,
    queryLagMs: 180_000,
    ingestBatchRetentionMs: 86_400_000,
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
  { method: 'POST', path: '/agent-api/metrics', internal: true, public: false },
  { method: 'GET', path: '/pubsub/status', internal: true, public: true },
  { method: 'POST', path: '/pubsub/broadcast', internal: true, public: true },
  { method: 'POST', path: '/pubsub/p2p', internal: true, public: true },
  { method: 'GET', path: '/tasks', internal: false, public: true },
  { method: 'POST', path: '/tasks', internal: false, public: true },
  { method: 'GET', path: '/instances', internal: false, public: true },
  { method: 'GET', path: '/agents', internal: false, public: true },
  { method: 'GET', path: '/variables', internal: false, public: true },
  { method: 'GET', path: '/metrics/namespaces', internal: false, public: true },
  { method: 'GET', path: '/metrics/names', internal: false, public: true },
  { method: 'GET', path: '/metrics/dimensions', internal: false, public: true },
  { method: 'GET', path: '/metrics/data', internal: false, public: true },
];

let listeners: Listeners | undefined;

/**
 * Guarded and cleared, because not every case starts a listener — and closing the
 * previous case's servers a second time surfaces as "Server is not running" inside
 * whichever test happened to run next, which is a long way from the cause.
 */
afterEach(async () => {
  await listeners?.close();
  listeners = undefined;
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

    // A page the operator visits can send a request here; this is what stops it reading the
    // answer — and the reason the internal listener installs no CORS at all, rather than a
    // narrowed allow-list.
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
    // The arrangement this is built for: agents on the LAN present no secret and are admitted
    // by address, while the listener that faces the internet refuses anything without a token.
    listeners = await start();

    expect((await listeners.public.get('/tasks')).status).toBe(401);
    expect((await listeners.internal.post('/agent-api/heartbeat', {})).status).toBe(400);
  });

  // There is deliberately no case here for a public listener built without a token.
});

describe('the default token', () => {
  const warnings = (): jest.SpyInstance => jest.spyOn(LoggerFactory.getLogger('DependencyFactory'), 'warn').mockImplementation(() => undefined);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const buildWith = (authToken: string): jest.SpyInstance => {
    const warn = warnings();
    const config = aConfig();
    new DependencyFactory({ config: { ...config, public: { ...config.public, authToken } }, pool: new FakePool().asPool(), messageHub: new FakeHub() }).build();
    return warn;
  };

  it('says so on every start, because it is published and guards nothing', () => {
    // The whole of what makes shipping a known token defensible.
    const warn = buildWith(DEFAULT_PUBLIC_TOKEN);

    const said = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(said).toContain('secret.json');
    // The value itself, because it is also what the operator has to paste into the
    // console's token field — and a warning that withholds it sends them to the source.
    expect(said).toContain(DEFAULT_PUBLIC_TOKEN);
    // And the fix, not just the problem.
    expect(said).toContain('mini-cloud config init');
  });

  it('stays quiet about a token the operator actually chose', () => {
    // A warning on every start is only heard if it is not also printed when nothing is wrong.
    const warn = buildWith('a-real-secret');

    expect(warn.mock.calls.map((call) => String(call[0])).join('\n')).not.toContain('default token');
  });
});

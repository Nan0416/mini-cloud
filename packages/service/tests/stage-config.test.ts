import type { ServiceConfig } from '../src/stage-config';

/**
 * The config resolves once, in a module-level initialiser, so each case has to reset
 * the module registry and re-import it under a different environment. That is also
 * what the test is really about: this is the single place the service reads
 * `process.env`, and everything else takes its configuration as arguments.
 */
const VARIABLES = [
  'MINI_CLOUD_PORT',
  'MINI_CLOUD_HOST',
  'MINI_CLOUD_INTERNAL_PORT',
  'MINI_CLOUD_INTERNAL_HOST',
  'MINI_CLOUD_TRUSTED_SUBNETS',
  'MINI_CLOUD_PUBLIC_PORT',
  'MINI_CLOUD_PUBLIC_HOST',
  'MINI_CLOUD_PUBLIC_TOKEN',
  'MINI_CLOUD_DATABASE_URL',
  'MINI_CLOUD_CORS_ORIGINS',
  'MINI_CLOUD_CONSOLE_URL',
  'MINI_CLOUD_JOB_TICK_MS',
  'MINI_CLOUD_MAINTENANCE_TICK_MS',
  'MINI_CLOUD_AGENT_OFFLINE_AFTER_MS',
  'MINI_CLOUD_LAUNCH_TIMEOUT_MS',
  'MINI_CLOUD_START_TIMEOUT_MS',
  'MINI_CLOUD_RETENTION_DAYS',
  'MINI_CLOUD_RETENTION_TICK_MS',
] as const;

const loadWith = (env: Partial<Record<(typeof VARIABLES)[number], string>>): ServiceConfig => {
  for (const name of VARIABLES) {
    delete process.env[name];
  }
  Object.assign(process.env, env);
  let config: ServiceConfig | undefined;
  jest.isolateModules(() => {
    config = (require('../src/stage-config') as { config: ServiceConfig }).config;
  });
  return config as ServiceConfig;
};

const originalEnv = { ...process.env };

afterEach(() => {
  for (const name of VARIABLES) {
    delete process.env[name];
  }
  Object.assign(process.env, originalEnv);
});

describe('defaults', () => {
  it('starts with every value set, so importing the package never throws', () => {
    // A control plane that needs configuration before it will start is a worse first
    // five minutes than one that starts with sane defaults and says what they are.
    expect(() => loadWith({})).not.toThrow();
  });

  it('binds both listeners to loopback, because exposing either must be deliberate', () => {
    const config = loadWith({});

    // It commands processes on your machines. Listening on 0.0.0.0 by default would
    // make a laptop on an untrusted network an open remote-execution endpoint — and
    // for the public listener it would make opening the router the only step needed.
    expect(config.internal).toMatchObject({ host: '127.0.0.1', port: 3000 });
    expect(config.public).toMatchObject({ host: '127.0.0.1', port: 3001 });
  });

  it('keeps the agent-facing listener on the port agents already use', () => {
    // The split moves the operator's port, not the fleet's: one address in one
    // console, rather than a config change on every machine running an agent.
    expect(loadWith({}).internal.port).toBe(3000);
    expect(loadWith({}).internal.port).not.toBe(loadWith({}).public.port);
  });

  it('trusts loopback and the private ranges a home network uses', () => {
    const { trustedSubnets } = loadWith({}).internal;

    expect(trustedSubnets).toContain('192.168.0.0/16');
    expect(trustedSubnets).toContain('10.0.0.0/8');
    expect(trustedSubnets).toContain('127.0.0.0/8');
    // IPv6 is not optional on a modern home LAN: a device that picks it would be
    // refused by an allow-list written only in IPv4.
    expect(trustedSubnets).toContain('fc00::/7');
  });

  it('points at the local database when none is named', () => {
    expect(loadWith({}).databaseUrl).toBe('postgres://localhost:5432/mini_cloud');
  });

  /**
   * The internal listener has no token of its own, by design: the source address is
   * what guards it. There is deliberately nothing here to assert but the absence —
   * `InternalListenerConfig` carries no `authToken`, so a token could not be read for
   * it even if one were set.
   */
  it('reads no token for the internal listener, which is guarded by address alone', () => {
    expect(loadWith({}).internal).toEqual({
      host: '127.0.0.1',
      port: 3000,
      trustedSubnets: expect.arrayContaining(['192.168.0.0/16']),
    });
  });

  it('leaves the public token unset rather than throwing, so importing never fails', () => {
    // `config` resolves in a module-level initialiser and the CLI imports it for every
    // command. A required read here makes `mini-cloud task list` — and `--help` — die
    // on a missing variable before parsing an argument. The listener refuses to start
    // without one; that is enforced where a listener is built, not where it is read.
    expect(() => loadWith({})).not.toThrow();
    expect(loadWith({}).public.authToken).toBeUndefined();
  });

  it('allows any origin, so the console works wherever it is served from', () => {
    expect(loadWith({}).public.corsOrigins).toEqual(['*']);
  });

  it('sets scheduler intervals that keep the job tick at or below the minimum interval', () => {
    const { scheduler } = loadWith({});

    // A tick slower than the shortest job interval would let occurrences fall between
    // ticks and never fire; 1s against a 5s floor leaves headroom.
    expect(scheduler.jobTickMs).toBe(1_000);
    expect(scheduler.jobTickMs).toBeLessThanOrEqual(5_000);
  });

  it('gives an agent three maintenance ticks of silence before calling it offline', () => {
    const { scheduler } = loadWith({});

    // One slow tick must not flap an agent offline and straight back on.
    expect(scheduler.maintenanceTickMs).toBe(5_000);
    expect(scheduler.agentOfflineAfterMs).toBe(15_000);
    expect(scheduler.agentOfflineAfterMs / scheduler.maintenanceTickMs).toBe(3);
  });

  it('waits far longer for a process to report a pid than for an agent to acknowledge', () => {
    const { scheduler } = loadWith({});

    // Acknowledging is a socket write; starting can mean loading a large model.
    expect(scheduler.launchTimeoutMs).toBe(15_000);
    expect(scheduler.startTimeoutMs).toBe(60_000);
  });

  it('keeps a year of history, swept hourly', () => {
    const { scheduler } = loadWith({});

    expect(scheduler.retentionDays).toBe(365);
    expect(scheduler.retentionTickMs).toBe(3600_000);
  });
});

describe('overrides', () => {
  it('takes the database from the environment', () => {
    expect(loadWith({ MINI_CLOUD_DATABASE_URL: 'postgres://db/mc' }).databaseUrl).toBe('postgres://db/mc');
  });

  it('keeps the pre-split variables pointed at the internal listener', () => {
    const config = loadWith({ MINI_CLOUD_HOST: '192.168.1.50', MINI_CLOUD_PORT: '4000' });

    // An upgrade must not silently move the port agents are configured for. These
    // named the only listener there was, and they still name that one.
    expect(config.internal).toMatchObject({ host: '192.168.1.50', port: 4000 });
  });

  it('lets the explicit names win over the pre-split ones', () => {
    const config = loadWith({
      MINI_CLOUD_HOST: '192.168.1.50',
      MINI_CLOUD_PORT: '4000',
      MINI_CLOUD_INTERNAL_HOST: '10.0.0.2',
      MINI_CLOUD_INTERNAL_PORT: '4100',
    });

    expect(config.internal).toMatchObject({ host: '10.0.0.2', port: 4100 });
  });

  it('configures the public listener separately', () => {
    const config = loadWith({ MINI_CLOUD_PUBLIC_HOST: '0.0.0.0', MINI_CLOUD_PUBLIC_PORT: '8080' });

    expect(config.public).toMatchObject({ host: '0.0.0.0', port: 8080 });
    // Naming the public listener must not drag the internal one out with it.
    expect(config.internal.host).toBe('127.0.0.1');
  });

  it('takes the public listener\u2019s token from its own variable', () => {
    // One variable, for the one listener that has a token. An agent never presents a
    // credential, so there is no fleet-wide token for a leaked console copy to be.
    expect(loadWith({ MINI_CLOUD_PUBLIC_TOKEN: 'operator' }).public.authToken).toBe('operator');
  });

  it('replaces the CORS default rather than adding to it', () => {
    const config = loadWith({ MINI_CLOUD_CORS_ORIGINS: 'http://localhost:5173,https://console.example.com' });

    // Naming origins has to genuinely narrow the service. Appending to the `*` default
    // would leave it wide open while looking restricted.
    expect(config.public.corsOrigins).toEqual(['http://localhost:5173', 'https://console.example.com']);
    expect(config.public.corsOrigins).not.toContain('*');
  });

  it('narrows the trusted subnets to exactly what is named', () => {
    expect(loadWith({ MINI_CLOUD_TRUSTED_SUBNETS: '192.168.1.0/24, 100.64.0.0/10' }).internal.trustedSubnets).toEqual(['192.168.1.0/24', '100.64.0.0/10']);
  });

  /**
   * An empty value has to mean "off" for both of these, and `getenvList` cannot say
   * it: it treats empty as unset and hands back the default, which turns the
   * documented way to disable a check into the way to keep it on.
   */
  it('honours an explicitly empty list as "no check at all"', () => {
    expect(loadWith({ MINI_CLOUD_CORS_ORIGINS: '' }).public.corsOrigins).toEqual([]);
    expect(loadWith({ MINI_CLOUD_TRUSTED_SUBNETS: '' }).internal.trustedSubnets).toEqual([]);
  });

  it('takes every scheduler interval from the environment', () => {
    const { scheduler } = loadWith({
      MINI_CLOUD_JOB_TICK_MS: '500',
      MINI_CLOUD_MAINTENANCE_TICK_MS: '2000',
      MINI_CLOUD_AGENT_OFFLINE_AFTER_MS: '6000',
      MINI_CLOUD_LAUNCH_TIMEOUT_MS: '7000',
      MINI_CLOUD_START_TIMEOUT_MS: '8000',
      MINI_CLOUD_RETENTION_DAYS: '30',
      MINI_CLOUD_RETENTION_TICK_MS: '60000',
    });

    expect(scheduler).toEqual({
      jobTickMs: 500,
      maintenanceTickMs: 2_000,
      agentOfflineAfterMs: 6_000,
      launchTimeoutMs: 7_000,
      startTimeoutMs: 8_000,
      retentionDays: 30,
      retentionTickMs: 60_000,
    });
  });

  it('refuses a non-numeric port, at startup', () => {
    // Number('abc') is NaN, which binds to a random port rather than failing.
    expect(() => loadWith({ MINI_CLOUD_PORT: 'abc' })).toThrow(/must be an integer/);
    expect(() => loadWith({ MINI_CLOUD_PUBLIC_PORT: 'abc' })).toThrow(/must be an integer/);
  });
});

/**
 * The console URL is the one value read straight from `process.env` rather than
 * through `getenv`, and the reason is this asymmetry: `getenv` treats an empty value
 * as unset and hands back the default, which would turn the documented way to switch
 * the startup link off into the way to keep it on.
 */
describe('console URL', () => {
  it('points at the hosted console by default', () => {
    expect(loadWith({}).consoleUrl).toBe('https://mini-cloud.qinnan.dev');
  });

  it('takes your own copy when you serve one', () => {
    expect(loadWith({ MINI_CLOUD_CONSOLE_URL: 'https://console.example.com' }).consoleUrl).toBe('https://console.example.com');
  });

  it('honours an explicitly empty value, which is how the link is switched off', () => {
    expect(loadWith({ MINI_CLOUD_CONSOLE_URL: '' }).consoleUrl).toBe('');
  });
});

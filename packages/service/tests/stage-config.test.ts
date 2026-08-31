import type { ServiceConfig } from '../src/stage-config';

/**
 * The config resolves once, in a module-level initialiser, so each case has to reset
 * the module registry and re-import it under a different environment. That is also
 * what the test is really about: this is the single place the service reads
 * `process.env`, and everything else takes its configuration as arguments.
 */
const VARIABLES = [
  'MINI_CLOUD_STAGE',
  'MINI_CLOUD_PORT',
  'MINI_CLOUD_HOST',
  'MINI_CLOUD_DATABASE_URL',
  'MINI_CLOUD_TOKEN',
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

  it('binds to loopback, because exposing the service must be deliberate', () => {
    const config = loadWith({});

    // It commands processes on your machines. Listening on 0.0.0.0 by default would
    // make a laptop on an untrusted network an open remote-execution endpoint.
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
  });

  it('defaults to the beta stage, and names the database after it', () => {
    const config = loadWith({});

    // Stage-suffixed, so a beta service cannot quietly point at the prod database.
    expect(config.stage).toBe('beta');
    expect(config.databaseUrl).toBe('postgres://localhost:5432/mini_cloud_beta');
  });

  it('names the database after whichever stage is set', () => {
    expect(loadWith({ MINI_CLOUD_STAGE: 'prod' }).databaseUrl).toBe('postgres://localhost:5432/mini_cloud_prod');
  });

  it('leaves authentication off, so local development needs no setup', () => {
    expect(loadWith({}).authToken).toBeUndefined();
  });

  it('allows any origin, so the console works wherever it is served from', () => {
    expect(loadWith({}).corsOrigins).toEqual(['*']);
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
  it('takes the host, port and database from the environment', () => {
    const config = loadWith({ MINI_CLOUD_HOST: '0.0.0.0', MINI_CLOUD_PORT: '4000', MINI_CLOUD_DATABASE_URL: 'postgres://db/mc' });

    expect(config).toMatchObject({ host: '0.0.0.0', port: 4000, databaseUrl: 'postgres://db/mc' });
  });

  it('enables authentication when a token is set', () => {
    expect(loadWith({ MINI_CLOUD_TOKEN: 's3cret' }).authToken).toBe('s3cret');
  });

  it('replaces the CORS default rather than adding to it', () => {
    const config = loadWith({ MINI_CLOUD_CORS_ORIGINS: 'http://localhost:5173,https://console.example.com' });

    // Naming origins has to genuinely narrow the service. Appending to the `*` default
    // would leave it wide open while looking restricted.
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'https://console.example.com']);
    expect(config.corsOrigins).not.toContain('*');
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

  it('refuses a stage it does not recognise, at startup', () => {
    // Silently falling back to beta would point a service someone believed was
    // production at the wrong database.
    expect(() => loadWith({ MINI_CLOUD_STAGE: 'gamma' })).toThrow(/must be one of \[beta, prod]/);
  });

  it('refuses a non-numeric port, at startup', () => {
    // Number('abc') is NaN, which binds to a random port rather than failing.
    expect(() => loadWith({ MINI_CLOUD_PORT: 'abc' })).toThrow(/must be an integer/);
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

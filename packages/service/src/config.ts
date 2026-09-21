import { AgentSettings, LoggerFactory } from '@mini-cloud/shared';
import { dirname, join } from 'node:path';
import { configPath, readConfigObject, secretPath, Section } from './config-file';
import { SchedulerConfig } from './facades/scheduler';
import { MetricConfig } from './services/metric-service';

const logger = LoggerFactory.getLogger('Config');

const DEFAULT_CORS_ORIGINS: ReadonlyArray<string> = ['*'];

const DEFAULT_TRUSTED_SUBNETS: ReadonlyArray<string> = ['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7', 'fe80::/10'];

const DEFAULT_CONSOLE_URL = 'https://mini-cloud.qinnan.dev';

/**
 * A placeholder, not a secret: it is published here, so it protects nothing. The
 * listener warns on every start, and `mini-cloud config init` writes a generated one.
 */
export const DEFAULT_PUBLIC_TOKEN = '1234';

/** Where a listener binds. */
export interface ListenerConfig {
  readonly host: string;
  readonly port: number;
}

/** The listener agents talk to. Bound to the home network, never port-forwarded. */
export interface InternalListenerConfig extends ListenerConfig {
  /** Checked on requests and on WebSocket upgrades. Empty accepts any address. */
  readonly trustedSubnets: ReadonlyArray<string>;
}

/** The listener the console and the CLI talk to — the one that may face the internet. */
export interface PublicListenerConfig extends ListenerConfig {
  /** `*` allows any; empty installs no CORS at all, so only non-browser callers pass. */
  readonly corsOrigins: ReadonlyArray<string>;
  /**
   * Read from `secret.json`, never from `config.json`. Unset means
   * {@link DEFAULT_PUBLIC_TOKEN}, which authenticates nobody — check
   * {@link isDefaultPublicToken} before treating a caller as authenticated.
   */
  readonly authToken: string;
}

/** What the CLI needs to find the service it is driving. */
export interface CliConfig {
  /** The public listener: tasks, instances, the fleet, variables. */
  readonly serviceUrl: string;
  /** The internal listener: the agent API and the WebSocket hub. */
  readonly internalUrl: string;
}

/** The metrics section: what is kept, for how long, and how far behind reads run. */
export interface MetricsConfig extends MetricConfig {
  /** How often partitions are created and expired ones dropped. */
  readonly retentionTickMs: number;
}

export interface ServiceConfig {
  readonly databaseUrl: string;
  readonly internal: InternalListenerConfig;
  readonly public: PublicListenerConfig;
  /** For the link printed at startup. Empty suppresses that line. */
  readonly consoleUrl: string;
  readonly scheduler: SchedulerConfig;
  readonly metrics: MetricsConfig;
  readonly cli: CliConfig;
  /** Read on a worker machine; the control plane ignores it. */
  readonly agent: AgentSettings;
}

/** By value, not provenance: a hand-typed `1234` is exactly as guessable. */
export function isDefaultPublicToken(token: string): boolean {
  return token === DEFAULT_PUBLIC_TOKEN;
}

/**
 * The pair of files a given `--config` names. Exported because anything that reports or
 * writes them has to agree with what `loadConfig` reads — `config show` printing one
 * path while the token came from another is how a 401 becomes unexplainable.
 */
export function resolvePaths(options: LoadConfigOptions = {}): { configFile: string; secretFile: string } {
  const configFile = options.configPath ?? configPath();
  // A whole configuration is a directory, so `--config` picks up the secret beside it.
  const secretFile = options.secretPath ?? (options.configPath === undefined ? secretPath() : join(dirname(options.configPath), 'secret.json'));
  return { configFile, secretFile };
}

export interface LoadConfigOptions {
  /** Defaults to `~/.mini-cloud/config.json`. */
  readonly configPath?: string;
  /** Defaults to `~/.mini-cloud/secret.json`. */
  readonly secretPath?: string;
}

/**
 * Reads `~/.mini-cloud/config.json` and `~/.mini-cloud/secret.json`, giving
 * `flag > file > default`. The same file whether a terminal, launchd or systemd started
 * the process — a daemon inherits no shell.
 *
 * A function, not a constant: the CLI imports this package for every command, and
 * `mini-cloud --help` should not depend on a well-formed config file.
 */
export function loadConfig(options: LoadConfigOptions = {}): ServiceConfig {
  const { configFile: file, secretFile } = resolvePaths(options);

  const root = new Section(readConfigObject(file) ?? {}, file);
  const internal = root.section('internal');
  const publicSection = root.section('public');
  const scheduler = root.section('scheduler');
  const metrics = root.section('metrics');
  const cli = root.section('cli');
  const agent = root.section('agent');

  const config: ServiceConfig = {
    databaseUrl: root.string('databaseUrl', 'postgres://localhost:5432/mini_cloud'),
    internal: {
      // Loopback by default; set it to the LAN address agents reach this host on.
      host: internal.string('host', '127.0.0.1'),
      port: internal.positiveInteger('port', 3000),
      trustedSubnets: internal.stringList('trustedSubnets', DEFAULT_TRUSTED_SUBNETS),
    },
    public: {
      // Loopback here too: this is the listener a port forward would point at.
      host: publicSection.string('host', '127.0.0.1'),
      port: publicSection.positiveInteger('port', 3001),
      corsOrigins: publicSection.stringList('corsOrigins', DEFAULT_CORS_ORIGINS),
      authToken: readPublicToken(secretFile),
    },
    consoleUrl: root.string('consoleUrl', DEFAULT_CONSOLE_URL),
    scheduler: {
      // At or below the minimum job interval, or occurrences fall between ticks.
      jobTickMs: scheduler.positiveInteger('jobTickMs', 1_000),
      maintenanceTickMs: scheduler.positiveInteger('maintenanceTickMs', 5_000),
      // Three missed ticks, so one slow tick does not flap an agent offline.
      agentOfflineAfterMs: scheduler.positiveInteger('agentOfflineAfterMs', 15_000),
      launchTimeoutMs: scheduler.positiveInteger('launchTimeoutMs', 15_000),
      // Generous: a task that loads a large model takes a while to report a pid.
      startTimeoutMs: scheduler.positiveInteger('startTimeoutMs', 60_000),
      retentionDays: scheduler.positiveInteger('retentionDays', 365),
      retentionTickMs: scheduler.positiveInteger('retentionTickMs', 3600_000),
    },
    metrics: {
      // One number bounds three things: raw storage, how far back percentiles can
      // be answered, and how late an agent may report — so anything accepted always
      // has a partition to land in. Four weeks, so a month-on-month comparison is
      // still answerable at full resolution.
      rawRetentionDays: metrics.positiveInteger('rawRetentionDays', 28),
      // A little over a year, so this week can be compared with the same week last year.
      rollupRetentionDays: metrics.positiveInteger('rollupRetentionDays', 400),
      // Three agent ticks: a machine that misses one still lands inside the window,
      // so a chart never shows a bucket only some of the fleet has reported.
      queryLagMs: metrics.positiveInteger('queryLagMs', 180_000),
      // Far longer than an agent will retry, which is all this has to outlast.
      ingestBatchRetentionMs: metrics.positiveInteger('ingestBatchRetentionMs', 86_400_000),
      retentionTickMs: metrics.positiveInteger('retentionTickMs', 3600_000),
    },
    cli: {
      serviceUrl: cli.string('serviceUrl', 'http://127.0.0.1:3001'),
      internalUrl: cli.string('internalUrl', 'http://127.0.0.1:3000'),
    },
    // Passed through with no defaults applied: `resolveAgentConfig` owns those, and
    // duplicating them here would be a second set to keep in step.
    agent: {
      id: agent.optionalString('id'),
      name: agent.optionalString('name'),
      internalUrl: agent.optionalString('internalUrl'),
      port: agent.optionalPositiveInteger('port'),
      workDir: agent.optionalString('workDir'),
      heartbeatIntervalMs: agent.optionalPositiveInteger('heartbeatIntervalMs'),
      healthCheckTickMs: agent.optionalPositiveInteger('healthCheckTickMs'),
      passiveToleranceMs: agent.optionalPositiveInteger('passiveToleranceMs'),
      pingFailureThreshold: agent.optionalPositiveInteger('pingFailureThreshold'),
      metricsTickMs: agent.optionalPositiveInteger('metricsTickMs'),
      metricsSpoolDir: agent.optionalString('metricsSpoolDir'),
      hostMetrics: agent.optionalBoolean('hostMetrics'),
      maxHistogramBuckets: agent.optionalPositiveInteger('maxHistogramBuckets'),
    },
  };

  for (const section of [internal, publicSection, scheduler, metrics, cli, agent, root]) {
    section.reportUnknownKeys();
  }
  return config;
}

/**
 * `secret.json` alone. Accepting a token in `config.json` would make the split
 * advisory, and that file is the one people hand around.
 */
function readPublicToken(file: string): string {
  const secrets = readConfigObject(file);
  if (secrets === undefined) {
    return DEFAULT_PUBLIC_TOKEN;
  }
  const section = new Section(secrets, file);
  const token = section.string('publicToken', '').trim();
  section.reportUnknownKeys();
  if (token.length === 0) {
    logger.warn(`${file} has no "publicToken", so the default is in force.`);
    return DEFAULT_PUBLIC_TOKEN;
  }
  return token;
}

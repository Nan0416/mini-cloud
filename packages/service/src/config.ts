import { LoggerFactory } from '@mini-cloud/shared';
import { configPath, readConfigObject, secretPath, Section } from './config-file';
import { SchedulerConfig } from './facades/scheduler';

const logger = LoggerFactory.getLogger('Config');

const DEFAULT_CORS_ORIGINS: ReadonlyArray<string> = ['*'];

const DEFAULT_TRUSTED_SUBNETS: ReadonlyArray<string> = ['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7', 'fe80::/10'];

const DEFAULT_CONSOLE_URL = 'https://mini-cloud.qinnan.dev';

/**
 * The token a service that was never configured with one runs under.
 *
 * Published in this file, so it is known to anyone who can read the repository — which
 * makes it a placeholder, not a secret. It buys a first five minutes that need no
 * setup; what keeps it from being a hole is that the public listener says so on every
 * start, loudly, and that it binds to loopback unless told otherwise.
 *
 * `mini-cloud config init` writes a generated one, which is the way out of it.
 */
export const DEFAULT_PUBLIC_TOKEN = '1234';

/** What every listener has: where it binds, and what it demands of a caller. */
export interface ListenerConfig {
  readonly host: string;
  readonly port: number;
}

/**
 * The listener agents talk to, and the one the pub/sub hub is attached to. Bound to
 * the home network and never port-forwarded.
 */
export interface InternalListenerConfig extends ListenerConfig {
  /**
   * CIDR blocks a connection may come from, checked on requests and on WebSocket
   * upgrades. An empty list accepts any address, which is the way to switch the check
   * off.
   */
  readonly trustedSubnets: ReadonlyArray<string>;
}

/** The listener the console and the CLI talk to — the one that may face the internet. */
export interface PublicListenerConfig extends ListenerConfig {
  /**
   * Origins the web console may call this listener from. `*` allows any; an empty list
   * disables CORS entirely, so only non-browser callers get through.
   */
  readonly corsOrigins: ReadonlyArray<string>;
  /**
   * Bearer token every caller must present. Always a string, because there is no such
   * thing as a public listener without one: it is the listener a port forward points
   * at, and anything that reaches it can launch programs on your machines.
   *
   * Read from `secret.json`, never from `config.json` — see {@link secretPath}. Unset
   * means {@link DEFAULT_PUBLIC_TOKEN}, which is published and therefore no protection
   * at all; check it with {@link isDefaultPublicToken} before assuming a caller was
   * authenticated by it.
   */
  readonly authToken: string;
}

/** What the CLI needs to find the service it is driving. */
export interface CliConfig {
  /** The public listener, which serves tasks, instances, the fleet and variables. */
  readonly serviceUrl: string;
  /** The internal listener, where the agent API and the WebSocket hub are. */
  readonly internalUrl: string;
}

export interface ServiceConfig {
  readonly databaseUrl: string;
  readonly internal: InternalListenerConfig;
  readonly public: PublicListenerConfig;
  /**
   * Where the console is served, for the link printed at startup. An empty string
   * suppresses that line.
   */
  readonly consoleUrl: string;
  readonly scheduler: SchedulerConfig;
  readonly cli: CliConfig;
}

/**
 * Whether this service is running on the published placeholder.
 *
 * Compares the value rather than tracking where it came from, deliberately: a token
 * typed out in full is exactly as guessable as one that was defaulted into, so an
 * operator who wrote `"publicToken": "1234"` by hand deserves the same warning.
 */
export function isDefaultPublicToken(token: string): boolean {
  return token === DEFAULT_PUBLIC_TOKEN;
}

export interface LoadConfigOptions {
  /** Defaults to `~/.mini-cloud/config.json`. */
  readonly configPath?: string;
  /** Defaults to `~/.mini-cloud/secret.json`. */
  readonly secretPath?: string;
}

/**
 * Reads `~/.mini-cloud/config.json` and `~/.mini-cloud/secret.json`.
 *
 * Files, not environment variables, and deliberately not both. A daemon inherits no
 * shell — launchd and systemd read no profile — so environment configuration had to be
 * captured into the unit at install time, which made the unit a second copy of the
 * settings that went stale the moment anything changed and could only be corrected by
 * reinstalling it. A file the service reads at startup is the same file whether it was
 * started by a terminal, by launchd or by systemd, and editing it plus a restart is the
 * whole of reconfiguring.
 *
 * What is left is one layer over the defaults, plus whatever flags the command applies
 * on top: `flag > file > default`, with nothing invisible in between.
 *
 * A function rather than a constant resolved at import, because the CLI imports this
 * package for every command: reading files at import time would make `mini-cloud
 * --help` depend on a config file being well-formed.
 */
export function loadConfig(options: LoadConfigOptions = {}): ServiceConfig {
  const file = options.configPath ?? configPath();
  const secretFile = options.secretPath ?? secretPath();

  const root = new Section(readConfigObject(file) ?? {}, file);
  const internal = root.section('internal');
  const publicSection = root.section('public');
  const scheduler = root.section('scheduler');
  const cli = root.section('cli');

  const config: ServiceConfig = {
    databaseUrl: root.string('databaseUrl', 'postgres://localhost:5432/mini_cloud'),
    internal: {
      // Loopback by default: the service commands processes on your machines, so
      // exposing it needs to be a deliberate act. Set it to the LAN address agents
      // reach this host on.
      host: internal.string('host', '127.0.0.1'),
      port: internal.integer('port', 3000),
      trustedSubnets: internal.stringList('trustedSubnets', DEFAULT_TRUSTED_SUBNETS),
    },
    public: {
      // Loopback here too. This is the listener a port forward would point at, and a
      // default that silently accepted one would make opening the router the only step
      // needed to publish a remote-execution API.
      host: publicSection.string('host', '127.0.0.1'),
      port: publicSection.integer('port', 3001),
      corsOrigins: publicSection.stringList('corsOrigins', DEFAULT_CORS_ORIGINS),
      authToken: readPublicToken(secretFile),
    },
    consoleUrl: root.string('consoleUrl', DEFAULT_CONSOLE_URL),
    scheduler: {
      // Must stay at or below the minimum job interval, or occurrences fall between ticks.
      jobTickMs: scheduler.integer('jobTickMs', 1_000),
      maintenanceTickMs: scheduler.integer('maintenanceTickMs', 5_000),
      // Three missed maintenance ticks, so one slow tick does not flap an agent offline.
      agentOfflineAfterMs: scheduler.integer('agentOfflineAfterMs', 15_000),
      launchTimeoutMs: scheduler.integer('launchTimeoutMs', 15_000),
      // Generous: a task that loads a large model can take a while to report a pid.
      startTimeoutMs: scheduler.integer('startTimeoutMs', 60_000),
      retentionDays: scheduler.integer('retentionDays', 365),
      retentionTickMs: scheduler.integer('retentionTickMs', 3600_000),
    },
    cli: {
      serviceUrl: cli.string('serviceUrl', 'http://127.0.0.1:3001'),
      internalUrl: cli.string('internalUrl', 'http://127.0.0.1:3000'),
    },
  };

  for (const section of [internal, publicSection, scheduler, cli, root]) {
    section.reportUnknownKeys();
  }
  return config;
}

/**
 * The token, from `secret.json` alone.
 *
 * Deliberately refuses to read one out of `config.json`. Accepting it there would make
 * the split advisory, and the whole value of the split is that `config.json` can be
 * handed to someone without thinking about it — which stops being true the first time
 * it silently works.
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

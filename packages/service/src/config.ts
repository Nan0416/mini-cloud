import { getenv, getenvInteger } from '@mini-cloud/shared';
import { SchedulerConfig } from './facades/scheduler';

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
   * upgrades. Empty accepts any address, which is the way to switch the check off.
   */
  readonly trustedSubnets: ReadonlyArray<string>;
}

/** The listener the console and the CLI talk to — the one that may face the internet. */
export interface PublicListenerConfig extends ListenerConfig {
  /**
   * Origins the web console may call this listener from. `*` allows any; empty
   * disables CORS entirely, so only non-browser callers get through.
   */
  readonly corsOrigins: ReadonlyArray<string>;
  /**
   * Bearer token every caller must present. Always a string, because there is no such
   * thing as a public listener without one: it is the listener a port forward points
   * at, and anything that reaches it can launch programs on your machines.
   *
   * Unset means {@link DEFAULT_PUBLIC_TOKEN}, which is a published value and therefore
   * no protection at all against anyone who has read this repository. Check it with
   * {@link isDefaultPublicToken} before doing anything that assumes the caller was
   * authenticated by it.
   */
  readonly authToken: string;
}

export interface ServiceConfig {
  readonly databaseUrl: string;
  readonly internal: InternalListenerConfig;
  readonly public: PublicListenerConfig;
  /**
   * Where the console is served, for the link printed at startup. Empty suppresses
   * that line.
   */
  readonly consoleUrl: string;
  readonly scheduler: SchedulerConfig;
}

/**
 * A comma-separated list that an empty value *empties* rather than resets.
 *
 * `getenvList` treats an empty value as unset and hands back the default, which turns
 * the documented way to switch a check off — `MINI_CLOUD_CORS_ORIGINS=` — into the way
 * to keep it on. Same asymmetry `consoleUrl` reads around, and the same fix.
 */
function getenvClearableList(name: string, fallback: ReadonlyArray<string>): ReadonlyArray<string> {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The operator's token, or the published placeholder when they have not set one.
 *
 * An empty value is as unset as a missing one: `MINI_CLOUD_PUBLIC_TOKEN=` is what a
 * shell leaves behind when the variable it was meant to expand was itself unset, and
 * honouring it would start a listener whose token is the empty string — which is worse
 * than the default, because nothing warns about it.
 */
function resolvePublicToken(): string {
  const token = process.env['MINI_CLOUD_PUBLIC_TOKEN']?.trim();
  return token === undefined || token.length === 0 ? DEFAULT_PUBLIC_TOKEN : token;
}

/**
 * Whether this service is running on the published placeholder.
 *
 * Compares the value rather than tracking where it came from, deliberately: a token
 * typed out in full is exactly as guessable as one that was defaulted into, so an
 * operator who set `MINI_CLOUD_PUBLIC_TOKEN=1234` by hand deserves the same warning.
 */
export function isDefaultPublicToken(token: string): boolean {
  return token === DEFAULT_PUBLIC_TOKEN;
}

/**
 * Reads the environment. The single place this package does.
 *
 * A function, deliberately, rather than a constant resolved at import. The CLI imports
 * this package for every command, so an import-time read would mean `mini-cloud task
 * list` — and `--help` — depended on the service's environment to get as far as parsing
 * an argument. Reading it in the command that actually serves requests keeps that
 * dependency where it belongs, and lets a test load a configuration without reaching
 * through the module registry to do it.
 */
export function loadConfig(): ServiceConfig {
  return {
    databaseUrl: getenv('MINI_CLOUD_DATABASE_URL', `postgres://localhost:5432/mini_cloud`),
    internal: {
      // Loopback by default: the service commands processes on your machines, so
      // exposing it needs to be a deliberate act. Set it to the LAN address agents
      // reach this host on.
      host: getenv('MINI_CLOUD_INTERNAL_HOST', getenv('MINI_CLOUD_HOST', '127.0.0.1')),
      port: getenvInteger('MINI_CLOUD_INTERNAL_PORT', getenvInteger('MINI_CLOUD_PORT', 3000)),
      trustedSubnets: getenvClearableList('MINI_CLOUD_TRUSTED_SUBNETS', DEFAULT_TRUSTED_SUBNETS),
    },
    public: {
      // Loopback here too. This is the listener a port forward would point at, and a
      // default that silently accepted one would make opening the router the only
      // step needed to publish a remote-execution API.
      host: getenv('MINI_CLOUD_PUBLIC_HOST', '127.0.0.1'),
      port: getenvInteger('MINI_CLOUD_PUBLIC_PORT', 3001),
      authToken: resolvePublicToken(),
      // Setting the variable replaces the default rather than adding to it, so naming
      // your own origins genuinely narrows the service instead of widening it.
      corsOrigins: getenvClearableList('MINI_CLOUD_CORS_ORIGINS', DEFAULT_CORS_ORIGINS),
    },
    // Read straight from `process.env` rather than through `getenv`, which collapses
    // an explicitly empty value to "unset" and would hand back the default — turning
    // the one way to switch the startup link off into the way to keep it on.
    consoleUrl: process.env['MINI_CLOUD_CONSOLE_URL'] ?? DEFAULT_CONSOLE_URL,
    scheduler: {
      // Must stay at or below the minimum job interval, or occurrences fall between ticks.
      jobTickMs: getenvInteger('MINI_CLOUD_JOB_TICK_MS', 1_000),
      maintenanceTickMs: getenvInteger('MINI_CLOUD_MAINTENANCE_TICK_MS', 5_000),
      // Three missed maintenance ticks, so one slow tick does not flap an agent offline.
      agentOfflineAfterMs: getenvInteger('MINI_CLOUD_AGENT_OFFLINE_AFTER_MS', 15_000),
      launchTimeoutMs: getenvInteger('MINI_CLOUD_LAUNCH_TIMEOUT_MS', 15_000),
      // Generous: a task that loads a large model can take a while to report a pid.
      startTimeoutMs: getenvInteger('MINI_CLOUD_START_TIMEOUT_MS', 60_000),
      retentionDays: getenvInteger('MINI_CLOUD_RETENTION_DAYS', 365),
      retentionTickMs: getenvInteger('MINI_CLOUD_RETENTION_TICK_MS', 3600_000),
    },
  };
}

import { getenv, getenvInteger, getenvOneOf } from '@mini-cloud/shared';
import { SchedulerConfig } from './facades/scheduler';

export type Stage = 'beta' | 'prod';
export const STAGES: ReadonlyArray<Stage> = ['beta', 'prod'];

/**
 * Any origin, so that the console works wherever it is served from without
 * configuration.
 *
 * This is a deliberate choice for a home-lab control plane, and it is a wide one: a
 * browser sends the request, so binding to loopback does not keep a page the operator
 * happens to be visiting from reaching the service and reading the answer. It applies
 * to the public listener alone — the internal one installs no CORS middleware at all,
 * which is what keeps a visited page away from agent traffic and the hub.
 */
const DEFAULT_CORS_ORIGINS: ReadonlyArray<string> = ['*'];

/**
 * Loopback plus the ranges a home network actually uses: RFC 1918 for IPv4, unique
 * local and link-local for IPv6.
 *
 * Carrier-grade NAT (`100.64.0.0/10`) is left out on purpose even though Tailscale
 * hands out addresses from it — a range that admits a machine the operator never
 * joined to anything does not belong in a default. Add it when you run a mesh VPN.
 */
const DEFAULT_TRUSTED_SUBNETS: ReadonlyArray<string> = ['127.0.0.0/8', '::1/128', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7', 'fe80::/10'];

/**
 * The hosted console, used only to build a link printed at startup. Nothing is ever
 * sent there — the console is a static page that talks to whichever service the
 * visitor names — but point `MINI_CLOUD_CONSOLE_URL` at your own copy if you serve
 * one, or set it empty to print nothing.
 */
const DEFAULT_CONSOLE_URL = 'https://mini-cloud.qinnan.dev';

/** What every listener has: where it binds, and what it demands of a caller. */
export interface ListenerConfig {
  readonly host: string;
  readonly port: number;
  /** Bearer token callers must present. Unset disables authentication on this listener. */
  readonly authToken?: string;
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
}

export interface ServiceConfig {
  readonly stage: Stage;
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
 * The single place the service reads `process.env`. Everything else takes its
 * configuration as constructor arguments, which is what makes the pieces testable
 * without setting environment variables.
 *
 * `MINI_CLOUD_HOST`, `MINI_CLOUD_PORT` and `MINI_CLOUD_TOKEN` still configure the
 * internal listener under their old names. That is where an existing deployment's
 * agents already point, and where the WebSocket has always been — so an upgrade moves
 * the operator's own port, which is one address in one console, rather than every
 * agent's, which is a machine at a time.
 */
function loadConfig(): ServiceConfig {
  const stage = getenvOneOf('MINI_CLOUD_STAGE', STAGES, 'beta');
  const sharedToken = process.env['MINI_CLOUD_TOKEN'];

  return {
    stage,
    databaseUrl: getenv('MINI_CLOUD_DATABASE_URL', `postgres://localhost:5432/mini_cloud_${stage}`),
    internal: {
      // Loopback by default: the service commands processes on your machines, so
      // exposing it needs to be a deliberate act. Set it to the LAN address agents
      // reach this host on.
      host: getenv('MINI_CLOUD_INTERNAL_HOST', getenv('MINI_CLOUD_HOST', '127.0.0.1')),
      port: getenvInteger('MINI_CLOUD_INTERNAL_PORT', getenvInteger('MINI_CLOUD_PORT', 3000)),
      authToken: process.env['MINI_CLOUD_INTERNAL_TOKEN'] ?? sharedToken,
      trustedSubnets: getenvClearableList('MINI_CLOUD_TRUSTED_SUBNETS', DEFAULT_TRUSTED_SUBNETS),
    },
    public: {
      // Loopback here too. This is the listener a port forward would point at, and a
      // default that silently accepted one would make opening the router the only
      // step needed to publish a remote-execution API.
      host: getenv('MINI_CLOUD_PUBLIC_HOST', '127.0.0.1'),
      port: getenvInteger('MINI_CLOUD_PUBLIC_PORT', 3001),
      authToken: process.env['MINI_CLOUD_PUBLIC_TOKEN'] ?? sharedToken,
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

/**
 * Resolved once at import. Every value has a default, so importing the service
 * package never throws for missing configuration.
 */
export const config = loadConfig();

export default config;

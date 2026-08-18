import { getenv, getenvInteger, getenvList, getenvOneOf } from '@mini-cloud/shared';
import { SchedulerConfig } from './facades/scheduler';

export type Stage = 'beta' | 'prod';
export const STAGES: ReadonlyArray<Stage> = ['beta', 'prod'];

/**
 * Any origin, in every stage, so that the console works wherever it is served from
 * without configuration.
 *
 * This is a deliberate choice for a home-lab control plane, and it is a wide one: a
 * browser sends the request, so binding to loopback does not keep a page the operator
 * happens to be visiting from reaching the service and reading the answer. Narrow it
 * with `MINI_CLOUD_CORS_ORIGINS`, or close it with `MINI_CLOUD_TOKEN`, which the
 * console then has to present too.
 */
const DEFAULT_CORS_ORIGINS: ReadonlyArray<string> = ['*'];

export interface ServiceConfig {
  readonly stage: Stage;
  readonly port: number;
  readonly host: string;
  readonly databaseUrl: string;
  /** Bearer token agents and clients must present. Unset disables authentication. */
  readonly authToken?: string;
  /**
   * Origins the web console may call this service from. `*` allows any; empty
   * disables CORS entirely, so only non-browser callers get through.
   */
  readonly corsOrigins: ReadonlyArray<string>;
  readonly scheduler: SchedulerConfig;
}

/**
 * The single place the service reads `process.env`. Everything else takes its
 * configuration as constructor arguments, which is what makes the pieces testable
 * without setting environment variables.
 */
function loadConfig(): ServiceConfig {
  const stage = getenvOneOf('MINI_CLOUD_STAGE', STAGES, 'beta');

  return {
    stage,
    port: getenvInteger('MINI_CLOUD_PORT', 3000),
    // Loopback by default: the service commands processes on your machines, so
    // exposing it needs to be a deliberate act.
    host: getenv('MINI_CLOUD_HOST', '127.0.0.1'),
    databaseUrl: getenv('MINI_CLOUD_DATABASE_URL', `postgres://localhost:5432/mini_cloud_${stage}`),
    authToken: process.env['MINI_CLOUD_TOKEN'],
    // Setting the variable replaces the default rather than adding to it, so naming
    // your own origins genuinely narrows the service instead of widening it.
    corsOrigins: getenvList('MINI_CLOUD_CORS_ORIGINS', DEFAULT_CORS_ORIGINS),
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

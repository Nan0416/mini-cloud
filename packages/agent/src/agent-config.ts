import { InvalidRequestError, getenv, getenvInteger } from '@mini-cloud/shared';
import os from 'node:os';
import path from 'node:path';

export interface AgentConfig {
  readonly agentId: string;
  readonly name: string;
  /** Base URL of the service's internal listener, e.g. `http://127.0.0.1:3000`. */
  readonly serviceUrl: string;
  /** Port the local reporter API listens on. Bound to loopback only. */
  readonly port: number;
  /** Root for offline reports and default stdout/stderr files. */
  readonly workDir: string;
  readonly heartbeatIntervalMs: number;
  readonly healthCheckTickMs: number;
  /** Grace added to a passive check's period before calling it missed. */
  readonly passiveToleranceMs: number;
  /** Consecutive failed pings before an instance is reported unhealthy. */
  readonly pingFailureThreshold: number;
}

/** Command-line values, which take precedence over the environment. */
export interface AgentConfigOverrides {
  readonly agentId?: string;
  readonly name?: string;
  readonly serviceUrl?: string;
  readonly port?: number;
}

/**
 * The id a machine takes when none was configured, or `undefined` when its hostname
 * cannot identify one machine.
 *
 * Normalized rather than used raw: macOS reports `Nans-MacBook-Pro.local` locally and
 * `nans-macbook-pro` over SSH, and one machine registering under two ids depending on
 * how it was started is worse than the flag this default removes. The cost is that two
 * machines whose names differ only in case now collide, which is the rarer failure.
 */
export function defaultAgentId(hostname: string): string | undefined {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/\.local$/, '');
  // Every machine answers to `localhost`, so defaulting to it would hand the whole
  // fleet one id — and agents sharing an id receive each other's commands.
  if (normalized.length === 0 || normalized === 'localhost') {
    return undefined;
  }
  return normalized;
}

/**
 * The single place the agent reads `process.env`.
 *
 * Overrides are resolved here rather than applied by the caller afterwards, so
 * precedence is decided in one place and a value supplied only on the command line
 * is present before anything is validated.
 */
export function loadAgentConfig(overrides: AgentConfigOverrides = {}): AgentConfig {
  const workDir = getenv('MINI_CLOUD_AGENT_DIR', path.join(os.homedir(), '.mini-cloud', 'agent'));

  // A configured id wins, so several agents can share one machine. Only when none is
  // configured does the machine name itself, which is what makes the first agent on a
  // box `mini-cloud agent start` with no flags.
  const supplied = overrides.agentId ?? process.env['MINI_CLOUD_AGENT_ID'];
  const hostname = os.hostname();
  const agentId = supplied !== undefined && supplied.length > 0 ? supplied : defaultAgentId(hostname);
  if (agentId === undefined) {
    throw new InvalidRequestError(
      `This machine's hostname ("${hostname}") cannot identify one agent, because every machine answers to it. Pass --id <agentId> or set MINI_CLOUD_AGENT_ID.`,
    );
  }

  return {
    agentId,
    name: overrides.name ?? getenv('MINI_CLOUD_AGENT_NAME', agentId),
    // The internal listener: agents report there and take their commands from the hub
    // attached to it. Deliberately not `MINI_CLOUD_SERVICE_URL`, which the CLI reads
    // for the public listener — one variable naming two different ports depending on
    // which command read it is a shell that works until you run the other command.
    serviceUrl: overrides.serviceUrl ?? getenv('MINI_CLOUD_INTERNAL_URL', 'http://127.0.0.1:3000'),
    port: overrides.port ?? getenvInteger('MINI_CLOUD_AGENT_PORT', 3100),
    workDir,
    // Three heartbeats fit inside the service's default 15s offline window, so one
    // dropped request does not flap the agent offline.
    heartbeatIntervalMs: getenvInteger('MINI_CLOUD_HEARTBEAT_INTERVAL_MS', 5_000),
    healthCheckTickMs: getenvInteger('MINI_CLOUD_HEALTH_CHECK_TICK_MS', 5_000),
    passiveToleranceMs: getenvInteger('MINI_CLOUD_PASSIVE_TOLERANCE_MS', 2_000),
    pingFailureThreshold: getenvInteger('MINI_CLOUD_PING_FAILURE_THRESHOLD', 3),
  };
}

export function stdoutDir(config: AgentConfig): string {
  return path.join(config.workDir, 'stdout');
}

export function stderrDir(config: AgentConfig): string {
  return path.join(config.workDir, 'stderr');
}

export function offlineReportPath(config: AgentConfig): string {
  return path.join(config.workDir, 'offline-reports.jsonl');
}

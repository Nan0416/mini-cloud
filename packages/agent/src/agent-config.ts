import { getenv, getenvInteger } from '@mini-cloud/shared';
import os from 'os';
import path from 'path';

export interface AgentConfig {
  readonly agentId: string;
  readonly name: string;
  /** Base URL of the mini-cloud service, e.g. `http://127.0.0.1:3000`. */
  readonly serviceUrl: string;
  readonly token?: string;
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

/** The single place the agent reads `process.env`. */
export function loadAgentConfig(): AgentConfig {
  const workDir = getenv('MINI_CLOUD_AGENT_DIR', path.join(os.homedir(), '.mini-cloud', 'agent'));

  return {
    // No default: two agents sharing an id would each receive the other's commands.
    agentId: getenv('MINI_CLOUD_AGENT_ID'),
    name: getenv('MINI_CLOUD_AGENT_NAME', os.hostname()),
    serviceUrl: getenv('MINI_CLOUD_SERVICE_URL', 'http://127.0.0.1:3000'),
    token: process.env['MINI_CLOUD_TOKEN'],
    port: getenvInteger('MINI_CLOUD_AGENT_PORT', 3100),
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

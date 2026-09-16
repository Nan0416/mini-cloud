import { AgentSettings, InvalidRequestError } from '@mini-cloud/shared';
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

/**
 * The id a machine takes when none was configured, or `undefined` when its hostname
 * cannot identify one machine.
 *
 * Normalized rather than used raw: macOS reports `Nans-MacBook-Pro.local` locally and
 * `nans-macbook-pro` over SSH, and one machine registering under two ids depending on
 * how it was started is worse than the setting this default removes.
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
 * Resolves the agent's settings, applying every default.
 *
 * Takes values rather than reading them: the CLI is the only entry point, so it reads
 * `~/.mini-cloud/config.json` and hands the `agent` section here. That keeps the
 * defaults next to the type that gives them meaning.
 */
export function resolveAgentConfig(settings: AgentSettings = {}): AgentConfig {
  // A configured id wins, so several agents can share one machine. Only when none is
  // configured does the machine name itself.
  const hostname = os.hostname();
  const agentId = settings.id !== undefined && settings.id.length > 0 ? settings.id : defaultAgentId(hostname);
  if (agentId === undefined) {
    throw new InvalidRequestError(
      `This machine's hostname ("${hostname}") cannot identify one agent, because every machine answers to it. Set agent.id in ~/.mini-cloud/config.json.`,
    );
  }

  return {
    agentId,
    name: settings.name ?? agentId,
    // The internal listener, where agents report and the hub is attached — not the
    // public port the CLI uses.
    serviceUrl: settings.internalUrl ?? 'http://127.0.0.1:3000',
    port: settings.port ?? 3100,
    workDir: settings.workDir ?? path.join(os.homedir(), '.mini-cloud', 'agent'),
    // Three heartbeats fit inside the service's default 15s offline window, so one
    // dropped request does not flap the agent offline.
    heartbeatIntervalMs: settings.heartbeatIntervalMs ?? 5_000,
    healthCheckTickMs: settings.healthCheckTickMs ?? 5_000,
    passiveToleranceMs: settings.passiveToleranceMs ?? 2_000,
    pingFailureThreshold: settings.pingFailureThreshold ?? 3,
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

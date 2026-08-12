import { EnvironmentVariables } from './common';
import { HealthCheck } from './task';

export type AgentStatus = 'online' | 'offline';

/**
 * A worker host running `mini-cloud agent`. One physical machine may run several
 * agents, so an agent is an instance of the program, not a machine.
 *
 * Agents self-register on first heartbeat rather than being listed in config, so
 * adding a machine to the fleet requires no service restart.
 */
export interface TaskAgent {
  readonly agentId: string;
  readonly name: string;
  readonly status: AgentStatus;
  /** Epoch ms of the most recent heartbeat. */
  readonly lastSeenAt?: number;
  readonly registeredAt: number;
}

/** Everything an agent needs to spawn a process, resolved by the service at launch time. */
export interface LaunchInstruction {
  readonly taskId: string;
  readonly version: number;
  readonly instanceId: string;
  readonly cmd: string;
  readonly cwd: string;
  readonly arguments?: ReadonlyArray<string>;
  readonly env?: EnvironmentVariables;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly healthCheck?: HealthCheck;
}

export interface LaunchInstanceCommand {
  readonly type: 'launch-instance';
  readonly instruction: LaunchInstruction;
}

export interface TerminateInstanceCommand {
  readonly type: 'terminate-instance';
  readonly instanceId: string;
  readonly pid: number;
}

export interface TerminateAgentCommand {
  readonly type: 'terminate-agent';
}

/** Fleet-wide liveness probe. Agents answer with a heartbeat. */
export interface RequestHeartbeatCommand {
  readonly type: 'request-heartbeat';
}

export type AgentCommand = LaunchInstanceCommand | TerminateInstanceCommand | TerminateAgentCommand | RequestHeartbeatCommand;

export const AGENT_COMMAND_TYPES: ReadonlyArray<AgentCommand['type']> = ['launch-instance', 'terminate-instance', 'terminate-agent', 'request-heartbeat'];

import { EnvironmentVariables, HealthCheck } from '..';

export interface LaunchTaskInstanceRequest {
  readonly agentId: string;
  readonly taskId: string;
  readonly version: number;
  readonly taskInstanceId: string;
  readonly cmd: string; // support ${keyword} replacement
  readonly cwd: string;
  readonly arguments?: string[];
  readonly env?: EnvironmentVariables;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly healthCheck?: HealthCheck;
}

export interface LaunchTaskInstanceResponse {}

export interface TerminateTaskInstanceRequest {
  readonly agentId: string;
  readonly taskInstanceId: string;
  readonly pid: number;
}

export interface TerminateTaskInstanceResponse {}

export interface TerminateAgentRequest {
  readonly agentId: string;
}

export interface TerminateAgentResponse {}

export interface GetAgentStatusRequest {
  readonly agentId?: string;
}

export interface GetAgentStatusResponse {}
/**
 * The interface is used by task service to issue instructions to task agents.
 *
 * For now, the implementation is based on pub-sub. The task service will broadcast the request to a topic.
 */
export interface TaskAgentClient {
  launchTaskInstance(request: LaunchTaskInstanceRequest): Promise<LaunchTaskInstanceResponse>;

  terminateTaskInstance(request: TerminateTaskInstanceRequest): Promise<TerminateTaskInstanceResponse>;

  terminateAgent(request: TerminateAgentRequest): Promise<TerminateAgentResponse>;

  /**
   * @param agentId if undefined, then request all
   */
  getAgentStatus(request: GetAgentStatusRequest): Promise<GetAgentStatusResponse>;
}

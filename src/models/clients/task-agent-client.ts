import { EnvironmentVariables, HealthCheck } from '..';

export interface LaunchTaskInstanceRequest {
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
  readonly taskInstanceId: string;
  readonly pid: number;
}

export interface TerminateTaskInstanceResponse {}

export interface TerminateAgentRequest {}

export interface TerminateAgentResponse {}

export interface GetAgentStatusRequest {}

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

/**
 * Event models sent over websocket.
 */
export interface LaunchTaskInstanceEvent {
  readonly type: 'launch-task-instance';
  readonly agentId: string;
  readonly request: LaunchTaskInstanceRequest;
}

export interface TerminateTaskInstanceEvent {
  readonly type: 'terminate-task-instance';
  readonly agentId: string;
  readonly request: TerminateTaskInstanceRequest;
}

export interface TerminateAgentEvent {
  readonly type: 'terminate-agent';
  readonly agentId: string;
  readonly request: TerminateAgentRequest;
}

export interface GetAgentStatusEvent {
  readonly type: 'get-agent-status';
  readonly agentId?: string;
  readonly request: GetAgentStatusRequest;
}

export type TaskAgentRequestEvent = LaunchTaskInstanceEvent | TerminateTaskInstanceEvent | TerminateAgentEvent | GetAgentStatusEvent;

export interface TaskAgentRequestBroadcaster {
  send(event: TaskAgentRequestEvent): Promise<void>;
}

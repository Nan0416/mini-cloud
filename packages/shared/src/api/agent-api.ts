import { TaskAgent } from '../models/agent';
import { AgentReportedStatus, TaskEventLevel, TaskEventSource, TaskInstance, TaskInstanceStatus } from '../models/task-instance';

/**
 * Agent -> service. Registers the agent on first call and keeps it marked online
 * thereafter; the service expires agents it has not heard from recently.
 */
export interface HeartbeatRequest {
  readonly agentId: string;
  readonly name: string;
}

export interface HeartbeatResponse {}

export interface ReportInstanceStatusRequest {
  readonly instanceId: string;
  readonly status: AgentReportedStatus;
}

export interface ReportInstanceStatusResponse {}

export interface ReportInstancePidRequest {
  readonly instanceId: string;
  readonly pid: number;
}

export interface ReportInstancePidResponse {}

export interface ReportTaskEventRequest {
  readonly instanceId: string;
  readonly source: TaskEventSource;
  readonly timestamp: number;
  readonly level: TaskEventLevel;
  readonly payload: unknown;
}

export interface ReportTaskEventResponse {}

/**
 * Agent -> service, after a restart: which instances does the service believe this
 * agent is still hosting?
 *
 * Deliberately narrower than `ListTaskInstancesRequest`, which the console and the CLI
 * use. An agent needs to ask about itself, not to query the fleet's history, and the
 * internal listener's contract should be the small one — it is reachable by everything
 * on the home network without a token.
 */
export interface ListAgentInstancesRequest {
  readonly agentId: string;
  readonly status?: TaskInstanceStatus;
}

export interface ListAgentInstancesResponse {
  readonly instances: ReadonlyArray<TaskInstance>;
}

export interface ListAgentsRequest {}

export interface ListAgentsResponse {
  readonly agents: ReadonlyArray<TaskAgent>;
}

export interface TerminateAgentRequest {
  readonly agentId: string;
}

export interface TerminateAgentResponse {}

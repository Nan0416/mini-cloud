import { TaskAgent } from '../models/agent';
import { AgentReportedStatus, TaskEventLevel, TaskEventSource } from '../models/task-instance';

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

export interface ListAgentsRequest {}

export interface ListAgentsResponse {
  readonly agents: ReadonlyArray<TaskAgent>;
}

export interface TerminateAgentRequest {
  readonly agentId: string;
}

export interface TerminateAgentResponse {}

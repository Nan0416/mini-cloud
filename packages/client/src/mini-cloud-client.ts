import {
  BroadcastRequest,
  BroadcastResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  DeleteTaskRequest,
  DeleteTaskResponse,
  GetHealthRequest,
  GetHealthResponse,
  GetHubStatusRequest,
  GetHubStatusResponse,
  GetTaskDynamicsRequest,
  GetTaskDynamicsResponse,
  GetTaskInstanceRequest,
  GetTaskInstanceResponse,
  GetTaskRequest,
  GetTaskResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  LaunchTaskRequest,
  LaunchTaskResponse,
  ListAgentsRequest,
  ListAgentsResponse,
  ListHealthChecksRequest,
  ListHealthChecksResponse,
  ListReplacementVariablesRequest,
  ListReplacementVariablesResponse,
  ListTaskEventsRequest,
  ListTaskEventsResponse,
  ListTaskInstancesRequest,
  ListTaskInstancesResponse,
  ListTasksRequest,
  ListTasksResponse,
  PingRequest,
  PingResponse,
  ReportInstancePidRequest,
  ReportInstancePidResponse,
  ReportInstanceStatusRequest,
  ReportInstanceStatusResponse,
  ReportTaskEventRequest,
  ReportTaskEventResponse,
  SendToRequest,
  SendToResponse,
  SetReplacementVariablesRequest,
  SetReplacementVariablesResponse,
  SetTaskActiveRequest,
  SetTaskActiveResponse,
  SetTaskTargetAgentsRequest,
  SetTaskTargetAgentsResponse,
  TerminateAgentRequest,
  TerminateAgentResponse,
  TerminateTaskInstanceRequest,
  TerminateTaskInstanceResponse,
  UpdateTaskRequest,
  UpdateTaskResponse,
} from '@mini-cloud/shared';
import { HttpClient, HttpClientProps } from './http-client';

/**
 * The typed surface of the mini-cloud service.
 *
 * Every method takes exactly one Request interface and returns one Response
 * interface, both from `@mini-cloud/shared` — the CLI, the agent and any UI all
 * compile against the same contract the service implements.
 */
export class MiniCloudClient {
  private readonly http: HttpClient;

  constructor(props: HttpClientProps) {
    this.http = new HttpClient(props);
  }

  // ---- tasks ----

  async createTask(request: CreateTaskRequest): Promise<CreateTaskResponse> {
    return this.http.request('POST', '/tasks', { body: request });
  }

  async updateTask(request: UpdateTaskRequest): Promise<UpdateTaskResponse> {
    const { taskId, ...body } = request;
    return this.http.request('PUT', `/tasks/${encodeURIComponent(taskId)}`, { body });
  }

  async deleteTask(request: DeleteTaskRequest): Promise<DeleteTaskResponse> {
    return this.http.request('DELETE', `/tasks/${encodeURIComponent(request.taskId)}`);
  }

  async getTask(request: GetTaskRequest): Promise<GetTaskResponse> {
    return this.http.request('GET', `/tasks/${encodeURIComponent(request.taskId)}`, { query: { version: request.version } });
  }

  async listTasks(_request: ListTasksRequest): Promise<ListTasksResponse> {
    return this.http.request('GET', '/tasks');
  }

  async getTaskDynamics(request: GetTaskDynamicsRequest): Promise<GetTaskDynamicsResponse> {
    return this.http.request('GET', `/tasks/${encodeURIComponent(request.taskId)}/dynamics`);
  }

  async setTaskActive(request: SetTaskActiveRequest): Promise<SetTaskActiveResponse> {
    return this.http.request('PUT', `/tasks/${encodeURIComponent(request.taskId)}/active`, { body: { active: request.active } });
  }

  async setTaskTargetAgents(request: SetTaskTargetAgentsRequest): Promise<SetTaskTargetAgentsResponse> {
    return this.http.request('PUT', `/tasks/${encodeURIComponent(request.taskId)}/target-agents`, { body: { targetAgentIds: request.targetAgentIds } });
  }

  async launchTask(request: LaunchTaskRequest): Promise<LaunchTaskResponse> {
    const { taskId, ...body } = request;
    return this.http.request('POST', `/tasks/${encodeURIComponent(taskId)}/launch`, { body });
  }

  // ---- instances ----

  async getTaskInstance(request: GetTaskInstanceRequest): Promise<GetTaskInstanceResponse> {
    return this.http.request('GET', `/instances/${encodeURIComponent(request.instanceId)}`);
  }

  async listTaskInstances(request: ListTaskInstancesRequest): Promise<ListTaskInstancesResponse> {
    return this.http.request('GET', '/instances', { query: { ...request } });
  }

  async terminateTaskInstance(request: TerminateTaskInstanceRequest): Promise<TerminateTaskInstanceResponse> {
    return this.http.request('POST', `/instances/${encodeURIComponent(request.instanceId)}/terminate`);
  }

  async listTaskEvents(request: ListTaskEventsRequest): Promise<ListTaskEventsResponse> {
    return this.http.request('GET', `/instances/${encodeURIComponent(request.instanceId)}/events`, { query: { limit: request.limit } });
  }

  // ---- variables ----

  async listReplacementVariables(_request: ListReplacementVariablesRequest): Promise<ListReplacementVariablesResponse> {
    return this.http.request('GET', '/variables');
  }

  async setReplacementVariables(request: SetReplacementVariablesRequest): Promise<SetReplacementVariablesResponse> {
    return this.http.request('PUT', '/variables', { body: request });
  }

  // ---- agents ----

  async listAgents(_request: ListAgentsRequest): Promise<ListAgentsResponse> {
    return this.http.request('GET', '/agents');
  }

  async terminateAgent(request: TerminateAgentRequest): Promise<TerminateAgentResponse> {
    return this.http.request('POST', `/agents/${encodeURIComponent(request.agentId)}/terminate`);
  }

  // ---- agent-facing ----

  async heartbeat(request: HeartbeatRequest): Promise<HeartbeatResponse> {
    return this.http.request('POST', '/agent-api/heartbeat', { body: request });
  }

  async reportInstanceStatus(request: ReportInstanceStatusRequest): Promise<ReportInstanceStatusResponse> {
    return this.http.request('POST', '/agent-api/instance-status', { body: request });
  }

  async reportInstancePid(request: ReportInstancePidRequest): Promise<ReportInstancePidResponse> {
    return this.http.request('POST', '/agent-api/instance-pid', { body: request });
  }

  async reportTaskEvent(request: ReportTaskEventRequest): Promise<ReportTaskEventResponse> {
    return this.http.request('POST', '/agent-api/instance-event', { body: request });
  }

  async listHealthChecks(request: ListHealthChecksRequest): Promise<ListHealthChecksResponse> {
    return this.http.request('POST', '/agent-api/health-checks', { body: request });
  }

  // ---- pub/sub ----

  /**
   * Fans a message out to every subscriber of a topic.
   *
   * `publishedAt` is stamped here rather than by the service so that the envelope
   * measures the whole journey, network included. A caller that already has a
   * timestamp — replaying a buffered message, say — passes its own.
   */
  async broadcast(request: BroadcastRequest): Promise<BroadcastResponse> {
    return this.http.request('POST', '/pubsub/broadcast', { body: { ...request, publishedAt: request.publishedAt ?? Date.now() } });
  }

  /** Sends a message to one subscriber. `deliveredTo: 0` means it is not connected. */
  async sendTo(request: SendToRequest): Promise<SendToResponse> {
    return this.http.request('POST', '/pubsub/p2p', { body: { ...request, publishedAt: request.publishedAt ?? Date.now() } });
  }

  async getHubStatus(_request: GetHubStatusRequest): Promise<GetHubStatusResponse> {
    return this.http.request('GET', '/pubsub/status');
  }

  // ---- health ----

  /** Liveness. Needs no token, so it answers even when authentication is enabled. */
  async ping(_request: PingRequest = {}): Promise<PingResponse> {
    return this.http.request('GET', '/ping');
  }

  /** Readiness. Answers `degraded` with a 503 when the database is unreachable. */
  async getHealth(_request: GetHealthRequest = {}): Promise<GetHealthResponse> {
    return this.http.request('GET', '/health');
  }
}

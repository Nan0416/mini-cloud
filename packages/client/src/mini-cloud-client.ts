import {
  BroadcastRequest,
  BroadcastResponse,
  CreateMonitorRequest,
  CreateNotifierRequest,
  CreateNotifierResponse,
  DeleteNotifierRequest,
  DeleteNotifierResponse,
  GetNotifierRequest,
  GetNotifierResponse,
  ListNotifiersRequest,
  ListNotifiersResponse,
  TestNotifierRequest,
  TestNotifierResponse,
  UpdateNotifierRequest,
  UpdateNotifierResponse,
  CreateMonitorResponse,
  DeleteMonitorRequest,
  DeleteMonitorResponse,
  GetMonitorRequest,
  GetMonitorResponse,
  ListMonitorHistoryRequest,
  ListMonitorHistoryResponse,
  ListMonitorsRequest,
  ListMonitorsResponse,
  UpdateMonitorRequest,
  UpdateMonitorResponse,
  CreateDashboardRequest,
  CreateDashboardResponse,
  DeleteDashboardRequest,
  DeleteDashboardResponse,
  GetDashboardRequest,
  GetDashboardResponse,
  ListDashboardsRequest,
  ListDashboardsResponse,
  UpdateDashboardRequest,
  UpdateDashboardResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  DeleteTaskRequest,
  DeleteTaskResponse,
  GetHealthRequest,
  GetHealthResponse,
  GetMetricDataRequest,
  GetMetricDataResponse,
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
  ListAgentInstancesRequest,
  ListAgentInstancesResponse,
  ListAgentsRequest,
  ListAgentsResponse,
  ListMetricDimensionsRequest,
  ListMetricDimensionsResponse,
  ListMetricNamesRequest,
  ListMetricNamesResponse,
  ListMetricNamespacesRequest,
  ListMetricNamespacesResponse,
  PutMetricDataRequest,
  PutMetricDataResponse,
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

  // ---- metrics ----

  async listMetricNamespaces(request: ListMetricNamespacesRequest = {}): Promise<ListMetricNamespacesResponse> {
    return this.http.request('GET', '/metrics/namespaces', { query: { ...request } });
  }

  async listMetricNames(request: ListMetricNamesRequest): Promise<ListMetricNamesResponse> {
    return this.http.request('GET', '/metrics/names', { query: { ...request } });
  }

  async listMetricDimensions(request: ListMetricDimensionsRequest): Promise<ListMetricDimensionsResponse> {
    return this.http.request('GET', '/metrics/dimensions', { query: { ...request } });
  }

  async getMetricData(request: GetMetricDataRequest): Promise<GetMetricDataResponse> {
    const { dimensions, ...rest } = request;
    // The set is the series identity, so it travels as one parameter per dimension
    // rather than as a nested object a query string cannot express.
    const dimension = Object.entries(dimensions ?? {}).map(([name, value]) => `${name}:${value}`);
    return this.http.request('GET', '/metrics/data', { query: { ...rest, dimension } });
  }

  // ---- dashboards ----

  async listDashboards(_request: ListDashboardsRequest = {}): Promise<ListDashboardsResponse> {
    return this.http.request('GET', '/dashboards');
  }

  async getDashboard(request: GetDashboardRequest): Promise<GetDashboardResponse> {
    return this.http.request('GET', `/dashboards/${encodeURIComponent(request.name)}`);
  }

  async createDashboard(request: CreateDashboardRequest): Promise<CreateDashboardResponse> {
    return this.http.request('POST', '/dashboards', { body: request });
  }

  async updateDashboard(request: UpdateDashboardRequest): Promise<UpdateDashboardResponse> {
    const { name, ...body } = request;
    return this.http.request('PUT', `/dashboards/${encodeURIComponent(name)}`, { body });
  }

  async deleteDashboard(request: DeleteDashboardRequest): Promise<DeleteDashboardResponse> {
    return this.http.request('DELETE', `/dashboards/${encodeURIComponent(request.name)}`);
  }

  // ---- monitors ----

  async listMonitors(_request: ListMonitorsRequest = {}): Promise<ListMonitorsResponse> {
    return this.http.request('GET', '/monitors');
  }

  async getMonitor(request: GetMonitorRequest): Promise<GetMonitorResponse> {
    return this.http.request('GET', `/monitors/${encodeURIComponent(request.name)}`);
  }

  async createMonitor(request: CreateMonitorRequest): Promise<CreateMonitorResponse> {
    return this.http.request('POST', '/monitors', { body: request });
  }

  async updateMonitor(request: UpdateMonitorRequest): Promise<UpdateMonitorResponse> {
    const { name, ...body } = request;
    return this.http.request('PUT', `/monitors/${encodeURIComponent(name)}`, { body });
  }

  async deleteMonitor(request: DeleteMonitorRequest): Promise<DeleteMonitorResponse> {
    return this.http.request('DELETE', `/monitors/${encodeURIComponent(request.name)}`);
  }

  async listMonitorHistory(request: ListMonitorHistoryRequest): Promise<ListMonitorHistoryResponse> {
    return this.http.request('GET', `/monitors/${encodeURIComponent(request.name)}/history`, {
      query: { limit: request.limit, after: request.after, from: request.from, to: request.to },
    });
  }

  // ---- notifiers ----

  async listNotifiers(_request: ListNotifiersRequest = {}): Promise<ListNotifiersResponse> {
    return this.http.request('GET', '/notifiers');
  }

  async getNotifier(request: GetNotifierRequest): Promise<GetNotifierResponse> {
    return this.http.request('GET', `/notifiers/${encodeURIComponent(request.notifierId)}`);
  }

  async createNotifier(request: CreateNotifierRequest): Promise<CreateNotifierResponse> {
    return this.http.request('POST', '/notifiers', { body: request });
  }

  async updateNotifier(request: UpdateNotifierRequest): Promise<UpdateNotifierResponse> {
    const { notifierId, ...body } = request;
    return this.http.request('PUT', `/notifiers/${encodeURIComponent(notifierId)}`, { body });
  }

  async deleteNotifier(request: DeleteNotifierRequest): Promise<DeleteNotifierResponse> {
    return this.http.request('DELETE', `/notifiers/${encodeURIComponent(request.notifierId)}`);
  }

  async testNotifier(request: TestNotifierRequest): Promise<TestNotifierResponse> {
    return this.http.request('POST', `/notifiers/${encodeURIComponent(request.notifierId)}/test`);
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

  async putMetricData(request: PutMetricDataRequest): Promise<PutMetricDataResponse> {
    return this.http.request('POST', '/agent-api/metrics', { body: request });
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

  /**
   * The agent plane's instance list. `listTaskInstances` answers the same question for
   * the console and the CLI, but from the public listener — an agent only ever talks
   * to the internal one.
   */
  async listAgentInstances(request: ListAgentInstancesRequest): Promise<ListAgentInstancesResponse> {
    return this.http.request('POST', '/agent-api/instances', { body: request });
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

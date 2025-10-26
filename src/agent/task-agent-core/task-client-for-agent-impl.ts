import { LoggerFactory } from '@sparrow/logging-js';
import {
  ERROR_NAME_TO_CONSTRUCTOR,
  InternalServiceError,
  ListHealthChecksRequest,
  ListHealthChecksResponse,
  ListRunningInstancesRequest,
  ListRunningInstancesResponse,
  ReportAgentStatusRequest,
  ReportAgentStatusResponse,
  ReportTaskEventReponse,
  ReportTaskEventRequest,
  ReportTaskInstancePidRequest,
  ReportTaskInstancePidResponse,
  ReportTaskInstanceStatusRequest,
  ReportTaskInstanceStatusResponse,
  TaskClientForAgent,
} from '../../models';
import { HttpClient } from '@sparrow/http-client';

const logger = LoggerFactory.getLogger('TaskClientForAgentImpl');

export class TaskClientForAgentImpl implements TaskClientForAgent {
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.httpClient.configure({
      type: 'error-constructor',
      errorNameToConstructor: ERROR_NAME_TO_CONSTRUCTOR,
      serviceErrorConstructor: InternalServiceError,
    });
  }
  async listRunningInstances(request: ListRunningInstancesRequest): Promise<ListRunningInstancesResponse> {
    logger.info(`Send request to list running task instances on agent ${request.agentId}`);
    const response = await this.httpClient.send<ListRunningInstancesResponse>({
      method: 'GET',
      url: '/task-instances',
      query: { status: 'running' },
    });
    return response.body;
  }

  async listHealthChecks(request: ListHealthChecksRequest): Promise<ListHealthChecksResponse> {
    logger.info(`Send request to list health checks.`);
    const response = await this.httpClient.send<ListHealthChecksResponse>({
      method: 'POST',
      url: '/health-checks',
      body: request,
    });
    return response.body;
  }

  async reportTaskEvent(request: ReportTaskEventRequest): Promise<ReportTaskEventReponse> {
    logger.info(`Send request to report task instance ${request.taskInstanceId} ${request.level} event.`);
    const response = await this.httpClient.send<ListHealthChecksResponse>({
      method: 'POST',
      url: '/instance-event',
      body: request,
    });
    return response.body;
  }

  async reportTaskInstancePid(request: ReportTaskInstancePidRequest): Promise<ReportTaskInstancePidResponse> {
    logger.info(`Send request to report task instance ${request.taskInstanceId} pid ${request.pid}`);
    const response = await this.httpClient.send<ReportTaskInstancePidResponse>({
      method: 'POST',
      url: '/instance-pid',
      body: request,
    });
    return response.body;
  }

  async reportTaskInstanceStatus(request: ReportTaskInstanceStatusRequest): Promise<ReportTaskInstanceStatusResponse> {
    logger.info(`Send request to report task instance ${request.taskInstanceId} status ${request.status}`);
    const response = await this.httpClient.send<ReportTaskInstanceStatusResponse>({
      method: 'POST',
      url: '/instance-status',
      body: request,
    });
    return response.body;
  }

  async reportAgentStatus(request: ReportAgentStatusRequest): Promise<ReportAgentStatusResponse> {
    logger.debug(`Send request to report task agent status.`);
    const response = await this.httpClient.send<ReportAgentStatusResponse>({
      method: 'POST',
      url: '/agent-status',
      body: request,
    });
    return response.body;
  }
}

import { LoggerFactory, HttpClient } from '@ultrasa/dev-kit';
import {
  ReportEventRequest,
  ReportEventResponse,
  ReportExitRequest,
  ReportExitResponse,
  ReportPassiveHealthCheckRequest,
  ReportPassiveHealthCheckResponse,
  ReportPidRequest,
  ReportPidResponse,
  ReportTerminationRequest,
  ReportTerminationResponse,
  TaskReporterClient,
} from '@ultrasa/mini-cloud-models';

const logger = LoggerFactory.getLogger('TaskReporterClientImpl');

/**
 * Run inside task process.
 */
export class TaskReporterClientImpl implements TaskReporterClient {
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  async reportPid(request: ReportPidRequest): Promise<ReportPidResponse> {
    logger.debug(`Send request to agent to report task instance pid ${request.taskInstanceId} ${request.pid}`);
    const response = await this.httpClient.send<ReportPidResponse>({
      method: 'POST',
      url: '/task-reporter/pid',
      body: request,
    });
    return response.body;
  }

  async reportTermination(request: ReportTerminationRequest): Promise<ReportTerminationResponse> {
    logger.debug(`Send request to agent to report task instance termination ${request.taskInstanceId}`);
    const response = await this.httpClient.send<ReportTerminationResponse>({
      method: 'POST',
      url: '/task-reporter/termination',
      body: request,
    });
    return response.body;
  }

  async reportExit(request: ReportExitRequest): Promise<ReportExitResponse> {
    logger.debug(`Send request to agent to report task instance exit ${request.taskInstanceId} ${request.code}`);
    const response = await this.httpClient.send<ReportExitResponse>({
      method: 'POST',
      url: '/task-reporter/exit',
      body: request,
    });
    return response.body;
  }

  async reportEvent(request: ReportEventRequest): Promise<ReportEventResponse> {
    logger.debug(`Send request to agent to report task instance level ${request.taskInstanceId} ${request.level}`);
    const response = await this.httpClient.send<ReportEventResponse>({
      method: 'POST',
      url: '/task-reporter/event',
      body: request,
    });
    return response.body;
  }

  async reportPassiveHealthCheck(request: ReportPassiveHealthCheckRequest): Promise<ReportPassiveHealthCheckResponse> {
    logger.debug(`Send request to agent to report task instance health check ${request.taskInstanceId}`);
    const response = await this.httpClient.send<ReportPassiveHealthCheckResponse>({
      method: 'POST',
      url: '/task-reporter/passive-health-check',
      body: request,
    });
    return response.body;
  }
}

import { LoggerFactory } from '@sparrow/logging-js';
import { TaskClientForAgent } from '../../models';
import { HttpClient } from '@sparrow/http-client';

// used by task agent
const logger = LoggerFactory.getLogger('InternalClientImpl');

export class TaskClientForAgentImpl implements TaskClientForAgent {
  private readonly httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  async listRunningInstances(): Promise<TaskInstance[]> {
    logger.info(`send request to list running task instances`);
    const data = await this.sendRequest<ListTaskInstancesResponse>('GET', '/task-instances', { status: 'running' });
    return data.taskInstances.filter((i) => i.agentId === this.agentId);
  }

  async listHealthChecks(tasks: TaskIdentifier[]): Promise<TaskIdentifierWithHealthCheck[]> {
    logger.info(`send request to list health checks`);
    const request: ListHealthChecksRequest = {
      taskIdentifiers: tasks,
    };
    const data = await this.sendRequest<ListHealthChecksResponse>('POST', '/health-checks', {}, request);
    return data.healthChecks;
  }

  async reportTaskEvent(event: NewTaskEvent): Promise<void> {
    logger.info(`send request to report task instance ${event.instanceId} ${event.level} event`);
    await this.sendRequest('POST', '/instance-event', {}, event);
  }

  async reportPid(taskInstanceId: string, pid: number): Promise<void> {
    logger.info(`send request to report task instance ${taskInstanceId} pid ${pid}`);
    await this.sendRequest(
      'POST',
      '/instance-pid',
      {},
      {
        instanceId: taskInstanceId,
        pid: pid,
      },
    );
  }

  async reportStatus(taskInstanceId: string, status: AgentSideTaskStatus): Promise<void> {
    logger.info(`send request to report task instance ${taskInstanceId} status ${status}`);
    await this.sendRequest(
      'POST',
      '/instance-status',
      {},
      {
        instanceId: taskInstanceId,
        status: status,
      },
    );
  }

  async reportAgentStatus(): Promise<void> {
    logger.debug(`send request to report task agent status`);
    await this.sendRequest(
      'POST',
      '/agent-status',
      {},
      {
        agentId: this.agentId,
        agentName: this.agentName,
      },
    );
  }
}

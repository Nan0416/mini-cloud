import { LoggerFactory } from '@sparrow/logging-js';
import { LaunchTaskEvent, Publisher, RequestAgentStatusEvent, TerminateAgentEvent, TerminateTaskInstanceEvent } from '../../models';
import {
  TaskAgentClient,
  LaunchTaskInstanceRequest,
  GetAgentStatusRequest,
  GetAgentStatusResponse,
  LaunchTaskInstanceResponse,
  TerminateAgentRequest,
  TerminateAgentResponse,
  TerminateTaskInstanceRequest,
  TerminateTaskInstanceResponse,
} from '../../models/clients/task-agent-client';

const logger = LoggerFactory.getLogger('TaskAgentClientImpl');

export class TaskAgentClientImpl implements TaskAgentClient {
  private readonly topic: string;
  private readonly publisher: Publisher;

  constructor(topic: string, publisher: Publisher) {
    this.topic = topic;
    this.publisher = publisher;
  }

  async launchTaskInstance(request: LaunchTaskInstanceRequest): Promise<LaunchTaskInstanceResponse> {
    logger.info(`Broadcast task launching request to agent ${request.agentId}.`);
    await this.publisher.broadcast<LaunchTaskEvent>(this.topic, {
      agentId: request.agentId,
      type: 'launch-task',
      request: request,
    });
    return {};
  }

  async terminateTaskInstance(request: TerminateTaskInstanceRequest): Promise<TerminateTaskInstanceResponse> {
    logger.info(`Broadcast task terminating request to agent ${request.agentId} to terminate instance ${request.taskInstanceId} at pid ${request.pid}.`);
    await this.publisher.broadcast<TerminateTaskInstanceEvent>(this.topic, {
      agentId: request.agentId,
      type: 'terminate-task-instance',
      instanceId: request.taskInstanceId,
      pid: request.pid,
    });
    return {};
  }

  async terminateAgent(request: TerminateAgentRequest): Promise<TerminateAgentResponse> {
    logger.info(`Broadcast task agent terminating request to agent ${request.agentId}.`);
    await this.publisher.broadcast<TerminateAgentEvent>(this.topic, {
      agentId: request.agentId,
      type: 'terminate-agent',
    });
    return {};
  }

  async getAgentStatus(request: GetAgentStatusRequest): Promise<GetAgentStatusResponse> {
    logger.info(`Broadcast message to request agent ${request.agentId} status.`);
    await this.publisher.broadcast<RequestAgentStatusEvent>(this.topic, {
      type: 'request-agent-status',
      agentId: request.agentId,
    });

    return {};
  }
}

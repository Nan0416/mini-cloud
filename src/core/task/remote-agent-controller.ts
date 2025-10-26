import { LoggerFactory } from '@sparrow/logging-js';
import { LaunchTaskEvent, Publisher, RequestAgentStatusEvent, TerminateAgentEvent, TerminateTaskInstanceEvent } from '../../models';
import { AgentController, LaunchTaskInstanceRequest } from './agent-controller';

const logger = LoggerFactory.getLogger('RemoteAgentController');

export class RemoteAgentController implements AgentController {
  private readonly topic: string;
  private readonly publisher: Publisher;

  constructor(topic: string, publisher: Publisher) {
    this.topic = topic;
    this.publisher = publisher;
  }

  async requestAgentStatus(agentId?: string): Promise<void> {
    logger.info(`Broadcast message to request agent ${agentId} status.`);
    await this.publisher.broadcast<RequestAgentStatusEvent>(this.topic, {
      type: 'request-agent-status',
      agentId: agentId,
    });
  }

  async launch(agentId: string, request: LaunchTaskInstanceRequest): Promise<void> {
    logger.info(`Broadcast task launching request to agent ${agentId}.`);
    await this.publisher.broadcast<LaunchTaskEvent>(this.topic, {
      agentId: agentId,
      type: 'launch-task',
      request: request,
    });
  }

  async terminate(agentId: string, taskInstanceId: string, pid: number): Promise<void> {
    logger.info(`Broadcast task terminating request to agent ${agentId} to terminate instance ${taskInstanceId} at pid ${pid}.`);
    await this.publisher.broadcast<TerminateTaskInstanceEvent>(this.topic, {
      agentId: agentId,
      type: 'terminate-task-instance',
      instanceId: taskInstanceId,
      pid: pid,
    });
  }

  async terminateAgent(agentId: string): Promise<void> {
    logger.info(`Broadcast task agent terminating request to agent ${agentId}.`);
    await this.publisher.broadcast<TerminateAgentEvent>(this.topic, {
      agentId: agentId,
      type: 'terminate-agent',
    });
  }
}

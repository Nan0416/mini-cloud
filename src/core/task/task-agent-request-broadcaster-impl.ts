import { LoggerFactory } from '@sparrow/logging-js';
import { Publisher } from '../../models';
import { TaskAgentRequestBroadcaster, TaskAgentRequestEvent } from '../../models/clients/task-agent-client';

const logger = LoggerFactory.getLogger('TaskAgentRequestBroadcasterImpl');

export class TaskAgentRequestBroadcasterImpl implements TaskAgentRequestBroadcaster {
  private readonly topic: string;
  private readonly publisher: Publisher;

  constructor(topic: string, publisher: Publisher) {
    this.topic = topic;
    this.publisher = publisher;
  }

  async send(event: TaskAgentRequestEvent): Promise<void> {
    logger.info(`Broadcast task agent request ${event.type} to agent ${event.agentId}`);
    await this.publisher.broadcast<TaskAgentRequestEvent>(this.topic, event);
  }
}

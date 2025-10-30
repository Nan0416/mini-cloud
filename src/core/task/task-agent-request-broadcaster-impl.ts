import { LoggerFactory } from '@ultrasa/dev-kit';
import { Publisher, PublishTimestamp } from '@ultrasa/mini-cloud-models';
import { TaskAgentRequestBroadcaster, TaskAgentRequestEvent } from '@ultrasa/mini-cloud-models';

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
    await this.publisher.broadcast<TaskAgentRequestEvent & PublishTimestamp>({
      topic: this.topic,
      event: {
        ...event,
        _publishedAt: Date.now(),
      },
    });
  }
}

import { LoggerFactory } from '@sparrow/logging-js';
import { AsyncQueue } from '../../utilities';
import { TaskAgentHandler } from '../task-agent-core';
import { TaskAgentRequestEvent } from '../../models/clients/task-agent-client';

const logger = LoggerFactory.getLogger('AsyncHandler');

export class AsyncHandler {
  private readonly agentId: string;
  private readonly taskAgentHandler: TaskAgentHandler;
  private readonly asyncQueue: AsyncQueue<TaskAgentRequestEvent>;

  constructor(agentId: string, taskAgentHandler: TaskAgentHandler) {
    this.agentId = agentId;
    this.taskAgentHandler = taskAgentHandler;
    this.asyncQueue = new AsyncQueue<TaskAgentRequestEvent>();
    this.asyncQueue.onEvent = async (event) => await this.processEvent(event);
  }

  process(event: TaskAgentRequestEvent) {
    try {
      // todo: ajv
      // assertTaskServiceEvent(event);
    } catch (err: any) {
      logger.warn(`Invalid task service event ${err.message}`);
      return;
    }
    if (event.agentId === this.agentId || event.agentId === undefined) {
      logger.info(`Enqueue ${event.type} task service event`);
      this.asyncQueue.enqueue(event);
    } else {
      logger.info(`Ignore task service event because it's sent for a different task agent ${event.agentId}`);
    }
  }

  private async processEvent(event: TaskAgentRequestEvent) {
    logger.info(`Process ${event.type} task service request.`);
    if (event.type === 'launch-task-instance') {
      await this.taskAgentHandler.launchTaskInstance(event.request);
    } else if (event.type === 'terminate-task-instance') {
      await this.taskAgentHandler.terminateTaskInstance(event.request);
    } else if (event.type === 'terminate-agent') {
      // terminate itself.
      await this.taskAgentHandler.terminateAgent(event.request);
    } else if (event.type === 'get-agent-status') {
      await this.taskAgentHandler.getAgentStatus(event.request);
    }
  }
}

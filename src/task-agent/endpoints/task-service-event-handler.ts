import { LoggerFactory } from '@qinnan/logging-js';
import { TaskAgentFacade, TaskServiceEvent } from '@qinnan/task-types';
import { AsyncQueue } from '@qinnan/async-queue';
import { assertTaskServiceEvent } from './assertions';

const logger = LoggerFactory.getLogger('TaskServiceEventHandler');
export class TaskServiceEventHandler {
  private readonly agentId: string;
  private readonly taskAgentFacade: TaskAgentFacade;
  private readonly asyncQueue: AsyncQueue<TaskServiceEvent>;

  constructor(agentId: string, taskAgentFacade: TaskAgentFacade) {
    this.agentId = agentId;
    this.asyncQueue = new AsyncQueue<TaskServiceEvent>();
    this.taskAgentFacade = taskAgentFacade;
    this.asyncQueue.onEvent = async (event) => await this.processEvent(event);
  }

  process(event: TaskServiceEvent) {
    try {
      assertTaskServiceEvent(event);
    } catch (err: any) {
      logger.warn(`invalid task service event ${err.message}`);
      return;
    }
    if (event.agentId === this.agentId || event.agentId === undefined) {
      logger.info(`enqueue ${event.type} task service event`);
      this.asyncQueue.enqueue(event);
    } else {
      logger.info(`ignore task service event because it's sent for a different task agent ${event.agentId}`);
    }
  }

  private async processEvent(event: TaskServiceEvent) {
    logger.info(`process ${event.type} task service event`);
    if (event.type === 'launch-task') {
      await this.taskAgentFacade.handleLaunchRequest(event.request);
    } else if (event.type === 'terminate-task-instance') {
      await this.taskAgentFacade.handleTerminationRequest(event.instanceId, event.pid);
    } else if (event.type === 'terminate-agent') {
      // terminate itself.
      await this.taskAgentFacade.terminateAgent();
    } else if (event.type === 'request-agent-status') {
      await this.taskAgentFacade.handleAgentStatusRequest();
    }
  }
}

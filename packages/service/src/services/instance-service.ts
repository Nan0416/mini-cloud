import { LoggerFactory, NotFoundError, TaskEvent, TaskEventFormat, TaskEventLevel, TaskEventSource, TaskInstance, TaskInstanceStatus } from '@mini-cloud/shared';
import { TaskEventDao } from '../data/task-event-dao';
import { ListTaskInstancesInput, TaskInstanceDao } from '../data/task-instance-dao';
import { generateEventId, generateInstanceId } from '../utils/ids';

const logger = LoggerFactory.getLogger('InstanceService');

export interface AddEventInput {
  readonly instanceId: string;
  readonly source: TaskEventSource;
  readonly level: TaskEventLevel;
  readonly format: TaskEventFormat;
  readonly payload: unknown;
  readonly timestamp: number;
}

export interface InstanceServiceProps {
  readonly taskInstanceDao: TaskInstanceDao;
  readonly taskEventDao: TaskEventDao;
}

/** The lifecycle of individual task instances and their event log. */
export class InstanceService {
  private readonly taskInstanceDao: TaskInstanceDao;
  private readonly taskEventDao: TaskEventDao;

  constructor(props: InstanceServiceProps) {
    this.taskInstanceDao = props.taskInstanceDao;
    this.taskEventDao = props.taskEventDao;
  }

  async createInstance(taskId: string, taskVersion: number, agentId: string): Promise<string> {
    const instanceId = generateInstanceId();
    await this.taskInstanceDao.createInstance({ instanceId, taskId, taskVersion, agentId, status: 'init' });
    logger.info(`Created instance ${instanceId} for task ${taskId} v${taskVersion} on agent ${agentId}.`);
    return instanceId;
  }

  async getInstance(instanceId: string): Promise<TaskInstance> {
    const instance = await this.taskInstanceDao.getInstance(instanceId);
    if (instance === null) {
      throw new NotFoundError(`Task instance ${instanceId} does not exist.`);
    }
    return instance;
  }

  async listInstances(input: ListTaskInstancesInput): Promise<ReadonlyArray<TaskInstance>> {
    return this.taskInstanceDao.listInstances(input);
  }

  /**
   * Applies a status if it does not move the instance backwards.
   *
   * A rejected update is normal, not an error: reports race over the network and the
   * older one loses. Callers get told whether it landed so they can skip any
   * follow-up work.
   */
  async recordStatus(instanceId: string, status: TaskInstanceStatus): Promise<boolean> {
    const result = await this.taskInstanceDao.updateStatus(instanceId, status);
    if (!result.found) {
      throw new NotFoundError(`Task instance ${instanceId} does not exist.`);
    }
    return result.applied;
  }

  /** Records a status change and the event explaining it. */
  async recordStatusWithEvent(instanceId: string, status: TaskInstanceStatus, level: TaskEventLevel, message: string, source: TaskEventSource = 'service'): Promise<boolean> {
    const applied = await this.recordStatus(instanceId, status);
    await this.addEvent({ instanceId, source, level, format: 'string', payload: message, timestamp: Date.now() });
    return applied;
  }

  async recordPid(instanceId: string, pid: number): Promise<void> {
    const updated = await this.taskInstanceDao.setPid(instanceId, pid);
    if (!updated) {
      throw new NotFoundError(`Task instance ${instanceId} does not exist.`);
    }
    logger.info(`Instance ${instanceId} is running as pid ${pid}.`);
  }

  async addEvent(input: AddEventInput): Promise<void> {
    await this.taskEventDao.createEvent({ ...input, eventId: generateEventId() });
  }

  async listEvents(instanceId: string, limit: number = 500): Promise<ReadonlyArray<TaskEvent>> {
    return this.taskEventDao.listEvents(instanceId, limit);
  }

  async listStaleInstances(status: TaskInstanceStatus, olderThan: number): Promise<ReadonlyArray<TaskInstance>> {
    return this.taskInstanceDao.listStaleInstances(status, olderThan);
  }

  async pruneInstancesUpdatedBefore(before: number): Promise<number> {
    return this.taskInstanceDao.deleteInstancesUpdatedBefore(before);
  }
}

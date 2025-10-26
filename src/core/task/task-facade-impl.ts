import { LoggerFactory } from '@sparrow/logging-js';
import {
  CreateTaskRequest,
  ListHealthChecksRequest,
  ListTaskInstancesRequest,
  Task,
  TaskDynamics,
  TaskEvent,
  TaskIdentifier,
  TaskIdentifierWithHealthCheck,
  TaskInstance,
  TaskInstanceStatus,
  UpdateTaskRequest,
} from '../../models';
import { customAlphabet } from 'nanoid';
import { InternalTask } from './internal-models';
import { TaskDao } from './task-dao';
import { TASK_INSTANCE_STATUS_TO_ORDER } from './utilities';
import { v4 as uuidv4 } from 'uuid';
import lodash from 'lodash';
import { AsyncQueue } from '../../utilities';
import { EnhancedError, Errors } from '@sparrow/standard-error';
import { NewTaskEventRequest, TaskFacade } from './task-facade';

export const _taskId = customAlphabet('1234567890', 10);
export const _taskInstanceId = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

const logger = LoggerFactory.getLogger('TaskFacadeImpl');

interface TaskInstanceStatusUpdate {
  readonly instanceId: string;
  readonly status: TaskInstanceStatus;
}

export class TaskFacadeImpl implements TaskFacade {
  private readonly taskStore: TaskDao;
  private readonly cacheLatestTask: boolean;
  private readonly cacheTaskDynamics: boolean;
  private readonly taskIdToLatestTask: Map<string, Task>;
  private readonly taskIdToTaskDynamics: Map<string, TaskDynamics>;
  private readonly taskInstanceStatusUpdateQueue: AsyncQueue<TaskInstanceStatusUpdate>;
  constructor(taskStore: TaskDao, cacheLatestTask: boolean, cacheTaskDynamics: boolean) {
    this.taskStore = taskStore;
    this.cacheLatestTask = cacheLatestTask;
    this.cacheTaskDynamics = cacheTaskDynamics;
    this.taskIdToLatestTask = new Map();
    this.taskIdToTaskDynamics = new Map();
    this.taskInstanceStatusUpdateQueue = new AsyncQueue();
    this.taskInstanceStatusUpdateQueue.onEvent = async (event) => {
      await this.__updateTaskInstanceStatus(event.instanceId, event.status);
    };
  }

  async init(): Promise<void> {
    if (this.cacheLatestTask) {
      logger.info('Latest task cache is enabled, populate cache.');
      const tasks = await this.listLatestTaskFromStore();
      tasks.forEach((task) => this.taskIdToLatestTask.set(task.taskId, task));
    } else {
      logger.info('Latest task cache is disable.');
    }
  }

  async terminate(): Promise<void> {
    this.taskIdToLatestTask.clear();
  }

  async createTask(request: CreateTaskRequest): Promise<TaskIdentifier> {
    logger.info(`Create ${request.type} task ${request.name} cmd ${request.cmd} ${request.cwd}.`);
    const internalTask = this.convertUpsertTaskRequestToInternalTask(request, this.generateTaskId(), 1);
    logger.info(`Create task in store and assign task id ${internalTask.taskId} to ${request.type} task ${request.name}.`);
    await this.taskStore.createTask(internalTask);
    await this.taskStore.upsertTaskLatestVersion(internalTask.taskId, internalTask.version);
    await this.refreshCache(internalTask.taskId, internalTask.version);
    return {
      taskId: internalTask.taskId,
      version: internalTask.version,
    };
  }

  async updateTask(request: UpdateTaskRequest): Promise<TaskIdentifier> {
    logger.info(`Update task ${request.taskId}.`);
    const version = await this.taskStore.getTaskLatestVersion(request.taskId);
    if (version === undefined) {
      const message = `Failed to update task ${request.taskId} because it doesn't exist.`;
      logger.warn(message);
      throw EnhancedError.create(Errors.NOT_FOUND, 404, message);
    }
    logger.info(`Task ${request.taskId} latest version is ${version}.`);

    const task = await this.taskStore.getTask(request.taskId, version);
    if (task === undefined) {
      const message = `Failed to find task ${request.taskId} version ${version} but it should exist.`;
      logger.error(message);
      throw EnhancedError.create(Errors.INTERNAL_ERROR, 500, message);
    } else if (request.type !== task.type) {
      const message = `Can't update task ${request.taskId} type from ${task.type} to ${request.type}.`;
      logger.warn(message);
      throw EnhancedError.create(Errors.INVALID_REQUEST, 400, message);
    } else {
      // todo: avoid race condition
      logger.info(`Update task ${request.taskId} current latest version ${task.version}.`);
      const internalTask = this.convertUpsertTaskRequestToInternalTask(request, task.taskId, task.version + 1);
      await this.taskStore.createTask(internalTask);
      await this.taskStore.upsertTaskLatestVersion(internalTask.taskId, internalTask.version);
      await this.refreshCache(internalTask.taskId, internalTask.version);
      return {
        taskId: internalTask.taskId,
        version: internalTask.version,
      };
    }
  }

  private async refreshCache(taskId: string, version: number) {
    if (this.cacheLatestTask) {
      logger.info(`Refresh cache on task ${taskId} version ${version}.`);
      const task = await this.taskStore.getTask(taskId, version);
      if (task !== undefined) {
        this.taskIdToLatestTask.set(taskId, task);
      } else {
        const message = `Failed to reload just created task ${taskId} version ${version}.`;
        logger.error(message);
        throw EnhancedError.create(Errors.INTERNAL_ERROR, 500, message);
      }
    } else {
      logger.info("Don't need to refresh cache because the latest task cache feature is disabled.");
    }
  }

  private convertUpsertTaskRequestToInternalTask(request: CreateTaskRequest | UpdateTaskRequest, taskId: string, version: number): InternalTask {
    let blob: string;
    let firstLaunchAt: number | undefined = undefined;
    let duration: number | undefined = undefined;

    if (request.type === 'job') {
      blob = JSON.stringify({
        arguments: request.arguments,
        env: request.env,
      });
      firstLaunchAt = request.firstLaunchAt;
      duration = request.duration;
    } else if (request.type === 'service') {
      blob = JSON.stringify({
        arguments: request.arguments,
        env: request.env,
        healthCheck: request.healthCheck,
      });
    } else {
      const message = `Failed to create task due to invalid task type ${(request as any).type}`;
      logger.warn(message);
      throw EnhancedError.create(Errors.INVALID_REQUEST, 400, message);
    }

    return {
      taskId: taskId,
      version: version,
      name: request.name,
      description: request.description,
      type: request.type,
      cmd: request.cmd,
      cwd: request.cwd,
      stdout: request.stdout,
      stderr: request.stderr,
      firstLaunchAt: firstLaunchAt,
      duration: duration,
      blob: blob,
    };
  }

  async deleteTask(taskId: string): Promise<void> {
    logger.info(`Delete task ${taskId}.`);
    // task instance and event are deleted by ttl.
    this.taskIdToLatestTask.delete(taskId);
    this.taskIdToTaskDynamics.delete(taskId);
    await this.taskStore.deleteTaskLatestVersion(taskId);
    await this.taskStore.deleteTask(taskId);
    await this.taskStore.deleteTaskDynamics(taskId);
  }

  async getTask(taskId: string, version?: number): Promise<Task> {
    if (version === undefined) {
      logger.info(`Get latest task ${taskId}.`);
      if (this.cacheLatestTask) {
        logger.info(`Latest task cache is enabled, return latest task ${taskId} from cache.`);
        const task = this.taskIdToLatestTask.get(taskId);
        if (task === undefined) {
          const message = `Failed to update task ${taskId} because it doesn't exist.`;
          logger.warn(message);
          throw EnhancedError.create(Errors.NOT_FOUND, 404, message);
        } else {
          return task;
        }
      } else {
        const temp = await this.taskStore.getTaskLatestVersion(taskId);
        if (temp === undefined) {
          const message = `Failed to update task ${taskId} because it doesn't exist.`;
          logger.warn(message);
          throw EnhancedError.create(Errors.NOT_FOUND, 404, message);
        } else {
          return await this.getTaskWithVersion(taskId, temp);
        }
      }
    } else {
      return await this.getTaskWithVersion(taskId, version);
    }
  }

  private async getTaskWithVersion(taskId: string, version: number): Promise<Task> {
    logger.info(`Get task ${taskId} version ${version}.`);
    const task = await this.taskStore.getTask(taskId, version);
    if (task === undefined) {
      const message = `TaskId ${taskId} version ${version} doesn't exist.`;
      logger.warn(message);
      throw EnhancedError.create(Errors.NOT_FOUND, 404, message);
    } else {
      return task;
    }
  }

  async resetTaskActive(taskId: string, active: boolean): Promise<void> {
    logger.info(`Reset task ${taskId} active to ${active}.`);
    const dynamics = await this.getTaskDynamics(taskId);
    const newDynamics = {
      ...dynamics,
      active: active,
    };
    await this.populateTaskDynamics(newDynamics);
  }

  async resetTaskTargetAgents(taskId: string, targetAgentIds: string[]): Promise<void> {
    logger.info(`Reset task ${taskId} target agents to ${targetAgentIds.join(', ')}.`);
    const dynamics = await this.getTaskDynamics(taskId);
    const newDynamics = {
      ...dynamics,
      targetAgentIds: targetAgentIds,
    };
    await this.populateTaskDynamics(newDynamics);
  }

  private async populateTaskDynamics(dynamics: TaskDynamics) {
    logger.info(`Populate task dynamics ${dynamics.taskId}.`);
    if (this.cacheTaskDynamics) {
      this.taskIdToTaskDynamics.set(dynamics.taskId, dynamics);
    }
    await this.taskStore.upsertTaskDynamics(dynamics);
  }

  async getTaskDynamics(taskId: string): Promise<TaskDynamics> {
    logger.debug(`Get task dynamics ${taskId}.`);
    if (this.cacheTaskDynamics) {
      const result = this.taskIdToTaskDynamics.get(taskId);
      if (result) {
        logger.debug(`Found task dynamics ${taskId} from cache.`);
        return result;
      }
    }

    const dynamics = await this.getAndPopuplateTaskDynamicsFromStore(taskId);
    if (this.cacheTaskDynamics) {
      this.taskIdToTaskDynamics.set(taskId, dynamics);
    }
    return dynamics;
  }

  private async getAndPopuplateTaskDynamicsFromStore(taskId: string): Promise<TaskDynamics> {
    logger.debug(`Load task dynamics ${taskId} from mongodb.`);
    let dynamics = await this.taskStore.getTaskDynamics(taskId);
    if (dynamics === undefined) {
      const version = await this.taskStore.getTaskLatestVersion(taskId);
      if (version === undefined) {
        const message = `Failed to load task dynamics ${taskId} because its task doesn't exist.`;
        throw EnhancedError.create(Errors.NOT_FOUND, 404, message);
      } else {
        dynamics = this.buildDefaultTaskDynamics(taskId);
        logger.info(`Populate empty task dynamics for task ${taskId}.`);
        await this.taskStore.upsertTaskDynamics(dynamics);
      }
    }

    return dynamics;
  }

  private buildDefaultTaskDynamics(taskId: string): TaskDynamics {
    return {
      taskId: taskId,
      targetAgentIds: [],
      active: false,
    };
  }

  /**
   * method is called by the periodically jobs, so set log level to debug to avoid too many logs.
   * @returns
   */
  async listLatestTasks(): Promise<Task[]> {
    logger.debug('Query latest tasks.');
    if (this.cacheLatestTask) {
      logger.debug(`Latest task cache is enabled, return results from cache.`);
      return Array.from(this.taskIdToLatestTask.values());
    }

    return await this.listLatestTaskFromStore();
  }

  /**
   * the API based on the method is used by task agent. When task agent initializes, it will find the running instances on the
   * agent and start health check for them.
   * @param request
   */
  async listHealthChecks(request: ListHealthChecksRequest): Promise<TaskIdentifierWithHealthCheck[]> {
    logger.info(`List ${request.taskIdentifiers.length} task health checks.`);
    const chunks = lodash.chunk(request.taskIdentifiers, 10);
    const results: TaskIdentifierWithHealthCheck[] = [];
    for (let i = 0; i < chunks.length; i++) {
      await Promise.all(
        chunks[i].map(async (tv) => {
          logger.info(`Find ${tv.taskId} version ${tv.version} health check.`);
          const task = await this.taskStore.getTask(tv.taskId, tv.version);
          if (task?.type === 'service' && task.healthCheck !== undefined) {
            logger.info(`Found ${tv.taskId} version ${tv.version} health check.`);
            results.push({
              ...tv,
              healthCheck: task.healthCheck,
            });
          } else {
            logger.info(`Task ${tv.taskId} version ${tv.version} doesn't health check.`);
          }
        }),
      );
    }
    return results;
  }

  private async listLatestTaskFromStore(): Promise<Task[]> {
    logger.info('Query latest tasks from store.');
    const taskVersions = await this.taskStore.listLatestTaskVersions();
    logger.info(`Found ${taskVersions.length} latest task versions.`);
    const chunks = lodash.chunk(taskVersions, 20);
    const results: Task[] = [];
    for (let i = 0; i < chunks.length; i++) {
      await Promise.all(
        chunks[i].map(async (tv) => {
          const task = await this.taskStore.getTask(tv.taskId, tv.version);
          if (task === undefined) {
            logger.warn(`Missing task ${tv.taskId} version ${tv.version}.`);
          } else {
            results.push(task);
          }
        }),
      );
    }
    return results;
  }

  async getTaskInstance(instanceId: string): Promise<TaskInstance> {
    logger.info(`Get task instance ${instanceId}.`);
    const instance = await this.taskStore.getTaskInstance(instanceId);
    if (instance) {
      return instance;
    } else {
      const message = `Task instance ${instanceId} doesn't exist.`;
      logger.warn(message);
      throw EnhancedError.create(Errors.NOT_FOUND, 404, message);
    }
  }

  async createTaskInstance(taskId: string, version: number, agentId: string): Promise<string> {
    logger.info(`Create task instance for task ${taskId} version ${version}.`);
    const taskInstanceId = this.generateTaskInstanceId();
    await this.taskStore.createTaskInstance({
      instanceId: taskInstanceId,
      taskId: taskId,
      version: version,
      agentId: agentId,
      status: 'init',
    });
    logger.info(`Successfully created task instance ${taskInstanceId}.`);
    return taskInstanceId;
  }

  async updateTaskInstanceStatus(instanceId: string, status: TaskInstanceStatus): Promise<void> {
    logger.info(`Put task instance ${instanceId} ${status} status update request to async queue.`);
    /**
     * need to use async queue to handle the status update request. The sequence is important, for example, if a task instance
     * status is already "terminated", it can't go back to "terminating". However, the service can receive concurrent updating request.
     */
    this.taskInstanceStatusUpdateQueue.enqueue({
      instanceId: instanceId,
      status: status,
    });
  }

  private async __updateTaskInstanceStatus(instanceId: string, status: TaskInstanceStatus): Promise<void> {
    const targetStatusOrder = TASK_INSTANCE_STATUS_TO_ORDER[status];
    logger.info(`Update task instance ${instanceId} status to ${status} order ${targetStatusOrder}.`);

    /**
     * Without using the async queue, and imgine "terminated" and "terminating" status update requests come at the same time,
     * the following statement can return "termination_initiated" for both of the request. And if "terminated" first gets the response,
     * the later "terminating" request can still enter the if statement and override the "terminated" status to "terminating".
     *
     * So we need to use async queue here.
     */
    const currentStatus = await this.taskStore.getTaskInstanceStatus(instanceId);

    if (currentStatus !== undefined) {
      const currentStatusOrder = TASK_INSTANCE_STATUS_TO_ORDER[currentStatus];

      logger.info(`Task instance ${instanceId} current status is ${currentStatus} order ${currentStatusOrder}.`);

      if (targetStatusOrder < currentStatusOrder) {
        logger.warn(`Ignore the status update because the current status ${currentStatus} has a higher order than target status ${status}.`);
        return;
      }
    } else {
      const message = `Failed to find instance ${instanceId} status, possible due to the instance has reached ttl.`;
      logger.error(message);
      throw EnhancedError.create(Errors.INTERNAL_ERROR, 500, message);
    }

    await this.taskStore.updateTaskInstanceStatus(instanceId, status);
    logger.info(`Successfully updated task instance ${instanceId} status to ${status}.`);
  }

  async setTaskInstancPid(instanceId: string, pid: number): Promise<void> {
    logger.info(`Set task instance ${instanceId} pid to ${pid}.`);
    await this.taskStore.setTaskInstancePid(instanceId, pid);
    logger.info(`Successfully set task instance ${instanceId} pid to ${pid}.`);
  }

  async listTaskInstances(request: ListTaskInstancesRequest): Promise<TaskInstance[]> {
    logger.info(`List task instances, task ${request.taskId} version ${request.version}
      status ${request.status} 
      from ${request.from ? new Date(request.from).toISOString() : undefined} 
      to ${request.to ? new Date(request.to).toISOString() : undefined}.`);

    if (request.version !== undefined && request.taskId === undefined) {
      const message = "TaskId can't be blank when version is given.";
      logger.warn(message);
      throw EnhancedError.create(Errors.INVALID_REQUEST, 400, message);
    }

    return this.taskStore.listTaskInstances({
      status: request.status,
      taskId: request.taskId,
      version: request.version,
      from: request.from,
      to: request.to,
    });
  }

  async listTaskEvents(taskInstanceId: string): Promise<TaskEvent[]> {
    logger.info(`List task instance ${taskInstanceId} events.`);
    return await this.taskStore.listTaskEvents(taskInstanceId);
  }

  async addTaskEvent(request: NewTaskEventRequest): Promise<void> {
    logger.info(`Add ${request.level} task event to task instance ${request.instanceId} with timestamp ${new Date(request.timestamp).toISOString()}.`);
    const eventId = uuidv4();
    logger.info(`Sssign event id ${eventId} to the event.`);

    let payload: string;
    if (request.format === 'json') {
      if (typeof request.payload === 'object') {
        payload = JSON.stringify(request.payload);
      } else {
        const message = 'Invalid add task event request, payload must be an object when format is json.';
        logger.warn(message);
        throw EnhancedError.create(Errors.INVALID_REQUEST, 400, message);
      }
    } else if (request.format === 'string') {
      if (typeof request.payload === 'string') {
        payload = request.payload;
      } else {
        const message = 'Invalid add task event request, payload must be a string when format is string,';
        logger.warn(message);
        throw EnhancedError.create(Errors.INVALID_REQUEST, 400, message);
      }
    } else {
      const message = `Invalid add task event request, payload format ${request.format} is not supported.`;
      logger.warn(message);
      throw EnhancedError.create(Errors.INVALID_REQUEST, 400, message);
    }

    return await this.taskStore.addTaskEvent({
      instanceId: request.instanceId,
      eventId: eventId,
      source: request.source,
      timestamp: new Date(request.timestamp),
      level: request.level,
      format: request.format,
      payload: payload,
    });
  }

  private generateTaskId() {
    return _taskId();
  }

  private generateTaskInstanceId() {
    return _taskInstanceId();
  }
}

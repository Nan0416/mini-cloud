import { LoggerFactory } from '@sparrow/logging-js';
import { InternalServiceError, InvalidRequestError, Task, TaskDynamics, TaskIdentifierWithHealthCheck, TaskInstanceNotFoundError, TaskInstanceStatus, TaskNotFoundError } from '../../models';
import { TaskDao } from './task-dao';
import { TASK_INSTANCE_STATUS_TO_ORDER } from './utilities';
import { v4 as uuidv4 } from 'uuid';
import lodash from 'lodash';
import { AsyncQueue } from '../../utilities';
import {
  AddTaskEventInput,
  AddTaskEventOutput,
  CreateTaskInput,
  CreateTaskInstanceInput,
  CreateTaskInstanceOutput,
  CreateTaskOutput,
  DeleteTaskInput,
  DeleteTaskOutput,
  GetTaskDynamicsInput,
  GetTaskDynamicsOutput,
  GetTaskInput,
  GetTaskInstanceInput,
  GetTaskInstanceOutput,
  GetTaskOutput,
  ListHealthChecksInput,
  ListHealthChecksOutput,
  ListLatestTasksInput,
  ListLatestTasksOutput,
  ListTaskEventsInput,
  ListTaskEventsOutput,
  ListTaskInstancesInput,
  ListTaskInstancesOutput,
  ResetTaskActiveInput,
  ResetTaskActiveOutput,
  ResetTaskTargetAgentsInput,
  ResetTaskTargetAgentsOutput,
  SetTaskInstancePidInput,
  SetTaskInstancePidOutput,
  TaskAccessor,
  UpdateTaskInput,
  UpdateTaskInstanceStatusInput,
  UpdateTaskInstanceStatusOutput,
  UpdateTaskOutput,
} from './task-accessor';
import { InternalTask } from './internal-models';
import { customAlphabet } from 'nanoid';

const taskIdGenerator = customAlphabet('1234567890', 10);
const taskInstanceIdGenerator = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 10);

const logger = LoggerFactory.getLogger('TaskFacadeImpl');

interface TaskInstanceStatusUpdate {
  readonly instanceId: string;
  readonly status: TaskInstanceStatus;
}

export class TaskAccessorImpl implements TaskAccessor {
  private readonly taskDao: TaskDao;
  private readonly cacheLatestTask: boolean;
  private readonly cacheTaskDynamics: boolean;
  private readonly taskIdToLatestTask: Map<string, Task>;
  private readonly taskIdToTaskDynamics: Map<string, TaskDynamics>;
  private readonly taskInstanceStatusUpdateQueue: AsyncQueue<TaskInstanceStatusUpdate>;
  constructor(taskDao: TaskDao, cacheLatestTask: boolean, cacheTaskDynamics: boolean) {
    this.taskDao = taskDao;
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

  async createTask(input: CreateTaskInput): Promise<CreateTaskOutput> {
    logger.info(`Create ${input.type} task ${input.name} cmd ${input.cmd} ${input.cwd}.`);
    const internalTask = this.convertCreateTaskInputToInternalTask(input, taskIdGenerator(), 1);
    await this.taskDao.createTask(internalTask);
    await this.taskDao.upsertTaskLatestVersion(internalTask.taskId, internalTask.version);
    await this.refreshCache(internalTask.taskId, internalTask.version);
    return {
      taskId: internalTask.taskId,
      version: internalTask.version,
    };
  }

  async updateTask(input: UpdateTaskInput): Promise<UpdateTaskOutput> {
    logger.info(`Update task ${input.taskId}.`);
    const version = await this.taskDao.getTaskLatestVersion(input.taskId);
    if (version === undefined) {
      const message = `Failed to update task ${input.taskId} because it doesn't exist.`;
      logger.warn(message);
      throw new TaskNotFoundError(message);
    }
    logger.info(`Task ${input.taskId} latest version is ${version}.`);

    const task = await this.taskDao.getTask(input.taskId, version);
    if (task === undefined) {
      const message = `Failed to find task ${input.taskId} version ${version} but it should exist.`;
      logger.error(message);
      throw new InternalServiceError(message);
    } else if (input.type !== task.type) {
      const message = `Can't update task ${input.taskId} type from ${task.type} to ${input.type}.`;
      logger.warn(message);
      throw new InvalidRequestError(message);
    } else {
      // todo: avoid race condition
      logger.info(`Update task ${input.taskId} current latest version ${task.version}.`);
      const internalTask = this.convertCreateTaskInputToInternalTask(input, task.taskId, task.version + 1);
      await this.taskDao.createTask(internalTask);
      await this.taskDao.upsertTaskLatestVersion(internalTask.taskId, internalTask.version);
      await this.refreshCache(internalTask.taskId, internalTask.version);
      return {
        taskId: internalTask.taskId,
        version: internalTask.version,
      };
    }
  }

  private convertCreateTaskInputToInternalTask(input: CreateTaskInput | UpdateTaskInput, taskId: string, version: number): InternalTask {
    let blob: string;
    let firstLaunchAt: number | undefined = undefined;
    let duration: number | undefined = undefined;

    if (input.type === 'job') {
      blob = JSON.stringify({
        arguments: input.arguments,
        env: input.env,
      });
      firstLaunchAt = input.firstLaunchAt;
      duration = input.duration;
    } else if (input.type === 'service') {
      blob = JSON.stringify({
        arguments: input.arguments,
        env: input.env,
        healthCheck: input.healthCheck,
      });
    } else {
      const message = `Failed to create task due to invalid task type ${(input as any).type}`;
      logger.warn(message);
      throw new InvalidRequestError(message);
    }

    return {
      taskId: taskId,
      version: version,
      name: input.name,
      description: input.description,
      type: input.type,
      cmd: input.cmd,
      cwd: input.cwd,
      stdout: input.stdout,
      stderr: input.stderr,
      firstLaunchAt: firstLaunchAt,
      duration: duration,
      blob: blob,
    };
  }

  private async refreshCache(taskId: string, version: number) {
    if (this.cacheLatestTask) {
      logger.info(`Refresh cache on task ${taskId} version ${version}.`);
      const task = await this.taskDao.getTask(taskId, version);
      if (task !== undefined) {
        this.taskIdToLatestTask.set(taskId, task);
      } else {
        const message = `Failed to reload just created task ${taskId} version ${version}.`;
        logger.error(message);
        throw new InternalServiceError(message);
      }
    } else {
      logger.info("Don't need to refresh cache because the latest task cache feature is disabled.");
    }
  }

  async deleteTask(input: DeleteTaskInput): Promise<DeleteTaskOutput> {
    logger.info(`Delete task ${input.taskId}.`);
    // task instance and event are deleted by ttl.
    this.taskIdToLatestTask.delete(input.taskId);
    this.taskIdToTaskDynamics.delete(input.taskId);
    await this.taskDao.deleteTaskLatestVersion(input.taskId);
    await this.taskDao.deleteTask(input.taskId);
    await this.taskDao.deleteTaskDynamics(input.taskId);
    return {};
  }

  async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
    if (input.version === undefined) {
      logger.info(`Get latest task ${input.taskId}.`);
      if (this.cacheLatestTask) {
        logger.info(`Latest task cache is enabled, return latest task ${input.taskId} from cache.`);
        const task = this.taskIdToLatestTask.get(input.taskId);
        if (task === undefined) {
          const message = `Failed to update task ${input.taskId} because it doesn't exist.`;
          logger.warn(message);
          throw new TaskNotFoundError(message);
        } else {
          return {
            task: task,
          };
        }
      } else {
        const temp = await this.taskDao.getTaskLatestVersion(input.taskId);
        if (temp === undefined) {
          const message = `Failed to update task ${input.taskId} because it doesn't exist.`;
          logger.warn(message);
          throw new TaskNotFoundError(message);
        } else {
          return {
            task: await this.getTaskWithVersion(input.taskId, temp),
          };
        }
      }
    } else {
      return {
        task: await this.getTaskWithVersion(input.taskId, input.version),
      };
    }
  }

  private async getTaskWithVersion(taskId: string, version: number): Promise<Task> {
    logger.info(`Get task ${taskId} version ${version}.`);
    const task = await this.taskDao.getTask(taskId, version);
    if (task === undefined) {
      const message = `TaskId ${taskId} version ${version} doesn't exist.`;
      logger.warn(message);
      throw new TaskNotFoundError(message);
    } else {
      return task;
    }
  }

  async resetTaskActive(input: ResetTaskActiveInput): Promise<ResetTaskActiveOutput> {
    logger.info(`Reset task ${input.taskId} active to ${input.active}.`);
    const dynamics = await this.getTaskDynamicsWithCache(input.taskId);
    const newDynamics: TaskDynamics = {
      ...dynamics,
      active: input.active,
    };
    await this.populateTaskDynamics(newDynamics);
    return {};
  }

  async resetTaskTargetAgents(input: ResetTaskTargetAgentsInput): Promise<ResetTaskTargetAgentsOutput> {
    logger.info(`Reset task ${input.taskId} target agents to ${input.targetAgentIds.join(', ')}.`);
    const dynamics = await this.getTaskDynamicsWithCache(input.taskId);
    const newDynamics = {
      ...dynamics,
      targetAgentIds: input.targetAgentIds,
    };
    await this.populateTaskDynamics(newDynamics);
    return {};
  }

  private async populateTaskDynamics(dynamics: TaskDynamics) {
    logger.info(`Populate task dynamics ${dynamics.taskId}.`);
    if (this.cacheTaskDynamics) {
      this.taskIdToTaskDynamics.set(dynamics.taskId, dynamics);
    }
    await this.taskDao.upsertTaskDynamics(dynamics);
  }

  async getTaskDynamics(input: GetTaskDynamicsInput): Promise<GetTaskDynamicsOutput> {
    logger.info(`Get task dynamics ${input.taskId}.`);

    return {
      taskDynamics: await this.getTaskDynamicsWithCache(input.taskId),
    };
  }

  private async getTaskDynamicsWithCache(taskId: string): Promise<TaskDynamics> {
    if (this.cacheTaskDynamics) {
      const result = this.taskIdToTaskDynamics.get(taskId);
      if (result) {
        logger.debug(`Found task dynamics ${taskId} from cache.`);
        return result;
      }
    }

    const taskDynamics = await this.getAndPopuplateTaskDynamicsFromStore(taskId);
    if (this.cacheTaskDynamics) {
      this.taskIdToTaskDynamics.set(taskId, taskDynamics);
    }
    return taskDynamics;
  }

  private async getAndPopuplateTaskDynamicsFromStore(taskId: string): Promise<TaskDynamics> {
    logger.debug(`Load task dynamics ${taskId} from mongodb.`);
    let dynamics = await this.taskDao.getTaskDynamics(taskId);
    if (dynamics === undefined) {
      const version = await this.taskDao.getTaskLatestVersion(taskId);
      if (version === undefined) {
        const message = `Failed to load task dynamics ${taskId} because its task doesn't exist.`;
        throw new TaskNotFoundError(message);
      } else {
        dynamics = this.buildDefaultTaskDynamics(taskId);
        logger.info(`Populate empty task dynamics for task ${taskId}.`);
        await this.taskDao.upsertTaskDynamics(dynamics);
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
  async listLatestTasks(input: ListLatestTasksInput): Promise<ListLatestTasksOutput> {
    logger.debug('Query latest tasks.');
    if (this.cacheLatestTask) {
      logger.debug(`Latest task cache is enabled, return results from cache.`);
      return {
        tasks: Array.from(this.taskIdToLatestTask.values()),
      };
    }

    return {
      tasks: await this.listLatestTaskFromStore(),
    };
  }

  /**
   * the API based on the method is used by task agent. When task agent initializes, it will find the running instances on the
   * agent and start health check for them.
   * @param request
   */
  async listHealthChecks(input: ListHealthChecksInput): Promise<ListHealthChecksOutput> {
    logger.info(`List ${input.taskIdentifiers.length} task health checks.`);
    const chunks = lodash.chunk(input.taskIdentifiers, 10);
    const results: TaskIdentifierWithHealthCheck[] = [];
    for (let i = 0; i < chunks.length; i++) {
      await Promise.all(
        chunks[i].map(async (tv) => {
          logger.info(`Find ${tv.taskId} version ${tv.version} health check.`);
          const task = await this.taskDao.getTask(tv.taskId, tv.version);
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
    return {
      results: results,
    };
  }

  private async listLatestTaskFromStore(): Promise<Task[]> {
    logger.info('Query latest tasks from store.');
    const taskVersions = await this.taskDao.listLatestTaskVersions();
    logger.info(`Found ${taskVersions.length} latest task versions.`);
    const chunks = lodash.chunk(taskVersions, 20);
    const results: Task[] = [];
    for (let i = 0; i < chunks.length; i++) {
      await Promise.all(
        chunks[i].map(async (tv) => {
          const task = await this.taskDao.getTask(tv.taskId, tv.version);
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

  async getTaskInstance(input: GetTaskInstanceInput): Promise<GetTaskInstanceOutput> {
    logger.info(`Get task instance ${input.taskInstanceId}.`);
    const taskInstance = await this.taskDao.getTaskInstance(input.taskInstanceId);
    if (taskInstance) {
      return {
        taskInstance: taskInstance,
      };
    } else {
      const message = `Task instance ${input.taskInstanceId} doesn't exist.`;
      logger.warn(message);
      throw new TaskInstanceNotFoundError(message);
    }
  }

  async createTaskInstance(input: CreateTaskInstanceInput): Promise<CreateTaskInstanceOutput> {
    logger.info(`Create task instance for task ${input.taskId} version ${input.version}.`);
    const taskInstanceId = taskInstanceIdGenerator();
    await this.taskDao.createTaskInstance({
      instanceId: taskInstanceId,
      taskId: input.taskId,
      version: input.version,
      agentId: input.agentId,
      status: 'init',
    });
    logger.info(`Successfully created task instance ${taskInstanceId}.`);
    return {
      taskInstanceId: taskInstanceId,
    };
  }

  async updateTaskInstanceStatus(input: UpdateTaskInstanceStatusInput): Promise<UpdateTaskInstanceStatusOutput> {
    logger.info(`Put task instance ${input.taskInstanceId} ${input.status} status update request to async queue.`);
    /**
     * need to use async queue to handle the status update request. The sequence is important, for example, if a task instance
     * status is already "terminated", it can't go back to "terminating". However, the service can receive concurrent updating request.
     */
    this.taskInstanceStatusUpdateQueue.enqueue({
      instanceId: input.taskInstanceId,
      status: input.status,
    });

    return {};
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
    const currentStatus = await this.taskDao.getTaskInstanceStatus(instanceId);

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
      throw new InternalServiceError(message);
    }

    await this.taskDao.updateTaskInstanceStatus(instanceId, status);
    logger.info(`Successfully updated task instance ${instanceId} status to ${status}.`);
  }

  async setTaskInstancPid(input: SetTaskInstancePidInput): Promise<SetTaskInstancePidOutput> {
    logger.info(`Set task instance ${input.taskInstanceId} pid to ${input.pid}.`);
    await this.taskDao.setTaskInstancePid(input.taskInstanceId, input.pid);
    logger.info(`Successfully set task instance ${input.taskInstanceId} pid to ${input.pid}.`);
    return {};
  }

  async listTaskInstances(input: ListTaskInstancesInput): Promise<ListTaskInstancesOutput> {
    logger.info(`List task instances, task ${input.taskId} version ${input.version}
      status ${input.status} 
      from ${input.from ? new Date(input.from).toISOString() : undefined} 
      to ${input.to ? new Date(input.to).toISOString() : undefined}.`);

    if (input.version !== undefined && input.taskId === undefined) {
      const message = "TaskId can't be blank when version is given.";
      logger.warn(message);
      throw new InvalidRequestError(message);
    }

    let taskInstances = await this.taskDao.listTaskInstances({
      status: input.status,
      taskId: input.taskId,
      version: input.version,
      from: input.from,
      to: input.to,
    });

    if (typeof input.agentId === 'string') {
      logger.info(`Filter by agentId ${input.agentId}`);
      taskInstances = taskInstances.filter((instance) => instance.agentId === input.agentId);
    }
    return {
      taskInstances: taskInstances,
    };
  }

  async listTaskEvents(input: ListTaskEventsInput): Promise<ListTaskEventsOutput> {
    logger.info(`List task instance ${input.taskInstanceId} events.`);
    const taskEvents = await this.taskDao.listTaskEvents(input.taskInstanceId);
    return {
      taskEvents: taskEvents,
    };
  }

  async addTaskEvent(input: AddTaskEventInput): Promise<AddTaskEventOutput> {
    logger.info(`Add ${input.level} task event to task instance ${input.taskInstanceId} with timestamp ${new Date(input.timestamp).toISOString()}.`);
    const eventId = uuidv4();
    logger.info(`Sssign event id ${eventId} to the event.`);

    let payload: string;
    if (input.format === 'json') {
      if (typeof input.payload === 'object') {
        payload = JSON.stringify(input.payload);
      } else {
        const message = 'Invalid add task event request, payload must be an object when format is json.';
        logger.warn(message);
        throw new InvalidRequestError(message);
      }
    } else if (input.format === 'string') {
      if (typeof input.payload === 'string') {
        payload = input.payload;
      } else {
        const message = 'Invalid add task event request, payload must be a string when format is string,';
        logger.warn(message);
        throw new InvalidRequestError(message);
      }
    } else {
      const message = `Invalid add task event request, payload format ${input.format} is not supported.`;
      logger.warn(message);
      throw new InvalidRequestError(message);
    }

    await this.taskDao.addTaskEvent({
      instanceId: input.taskInstanceId,
      eventId: eventId,
      source: input.source,
      timestamp: new Date(input.timestamp),
      level: input.level,
      format: input.format,
      payload: payload,
    });

    return {};
  }
}

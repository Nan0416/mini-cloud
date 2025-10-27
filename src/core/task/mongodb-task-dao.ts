import TaskSchema from './mongoose-models/task';
import TaskInstanceSchema from './mongoose-models/task-instance';
import TaskEventSchema from './mongoose-models/task-event';
import LatestTaskIdSchema from './mongoose-models/latest-task-id';
import TaskDynamicsSchema from './mongoose-models/task-dynamics';
import { LoggerFactory } from '@sparrow/logging-js';
import { Task, TaskInstance, TaskEvent, Job, Service, TaskInstanceStatus, TaskEventLevel, TaskEventFormat, TaskEventSource, TaskDynamics, InternalServiceError } from '../../models';
import { InternalTask, InternalTaskInstance, InternalTaskEvent, InternalLatestTaskId, InternalTaskDynamics } from './internal-models';
import { TaskDao, ListTaskInstancesInput } from './task-dao';

interface Timestamps {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const logger = LoggerFactory.getLogger('MongoDBTaskDao');

export class MongoDBTaskDao implements TaskDao {
  constructor() {}

  async getTask(taskId: string, version: number): Promise<Task | undefined> {
    logger.info(`Mongodb query task ${taskId} version ${version}`);

    const doc = await TaskSchema.findOne({
      taskId: taskId,
      version: version,
    }).exec();

    if (doc !== null) {
      return this.convertInternalTaskToTask(doc.toObject<InternalTask & Timestamps>());
    } else {
      logger.info(`Mongodb doesn't find task ${taskId} version ${version}`);
      return undefined;
    }
  }

  async upsertTaskLatestVersion(taskId: string, version: number): Promise<void> {
    logger.info(`Mongodb upsert task ${taskId} latest version to ${version}`);
    await LatestTaskIdSchema.findOneAndUpdate({ taskId: taskId }, { taskId: taskId, version: version }, { upsert: true }).exec();
  }

  async getTaskLatestVersion(taskId: string): Promise<number | undefined> {
    logger.info(`Mongodb query latest version of task ${taskId}`);
    const doc = await LatestTaskIdSchema.findOne({
      taskId: taskId,
    }).exec();

    if (doc !== null) {
      return doc.toObject<InternalLatestTaskId>().version;
    } else {
      logger.info(`Mongodb doesn't find task ${taskId} latest version`);
      return undefined;
    }
  }

  async listLatestTaskVersions(): Promise<InternalLatestTaskId[]> {
    logger.info(`Mongodb query list latest version of all tasks`);
    const docs = await LatestTaskIdSchema.find({}).exec();
    logger.info(`Mongodb found ${docs.length} tasks`);
    return docs
      .map((doc) => doc.toObject<InternalLatestTaskId>())
      .map((obj) => ({
        taskId: obj.taskId,
        version: obj.version,
      }));
  }

  async createTask(internalTask: InternalTask): Promise<void> {
    logger.info(`Mongodb creates internal task ${internalTask.taskId} version ${internalTask.version}`);
    try {
      await TaskSchema.create(internalTask);
    } catch (err: any) {
      if (err.code === 11000) {
        const message = `Task ${internalTask.taskId} version ${internalTask.version} already existed in mongodb.`;
        logger.error(message);
        // Caller, we,guarantee task is unique.
        throw new InternalServiceError(message);
      }
      throw err;
    }
  }

  async deleteTask(taskId: string): Promise<void> {
    logger.info(`Mongodb deletes task ${taskId}`);
    await TaskSchema.deleteMany({ taskId });
  }

  async deleteTaskLatestVersion(taskId: string): Promise<void> {
    logger.info(`Mongodb deletes task ${taskId} latest version`);
    await LatestTaskIdSchema.deleteOne({ taskId });
  }

  async getTaskDynamics(taskId: string): Promise<TaskDynamics | undefined> {
    logger.info(`Mongodb query task dynamics ${taskId}`);
    const doc = await TaskDynamicsSchema.findOne({
      taskId: taskId,
    });
    if (doc !== null) {
      return this.convertInternalTaskDynamicsToTaskDynamics(doc.toObject<InternalTaskDynamics>());
    } else {
      logger.info(`Mongodb doesn't find task dynamics ${taskId}`);
      return undefined;
    }
  }

  private convertInternalTaskDynamicsToTaskDynamics(internalTaskDynamics: InternalTaskDynamics): TaskDynamics {
    return {
      taskId: internalTaskDynamics.taskId,
      targetAgentIds: internalTaskDynamics.targetAgentIds,
      active: internalTaskDynamics.active,
    };
  }

  async upsertTaskDynamics(taskDynamics: TaskDynamics): Promise<void> {
    logger.info(`Mongodb upserts task dynamics ${taskDynamics.taskId}`);
    await TaskDynamicsSchema.findOneAndUpdate(
      { taskId: taskDynamics.taskId },
      {
        taskId: taskDynamics.taskId,
        active: taskDynamics.active,
        targetAgentIds: taskDynamics.targetAgentIds,
      },

      { upsert: true },
    ).exec();
  }

  async deleteTaskDynamics(taskId: string): Promise<void> {
    logger.info(`Mongodb deletes task dynamics ${taskId}`);
    await TaskDynamicsSchema.deleteOne({ taskId });
  }

  async getTaskInstance(instanceId: string): Promise<TaskInstance | undefined> {
    logger.info(`Mongodb gets task instance ${instanceId}`);
    const doc = await TaskInstanceSchema.findOne({
      instanceId: instanceId,
    }).exec();

    if (doc !== null) {
      return this.convertInternalTaskInstanceToTaskInstance(doc.toObject<InternalTaskInstance & Timestamps>());
    } else {
      logger.info(`Mongodb doesn't find task instance ${instanceId}`);
      return undefined;
    }
  }

  async getTaskInstanceStatus(taskInstanceId: string): Promise<TaskInstanceStatus | undefined> {
    logger.info(`Mongodb gets task instance ${taskInstanceId} status`);
    const doc = await TaskInstanceSchema.findOne({
      instanceId: taskInstanceId,
    }).exec();
    if (doc !== null) {
      return doc.toObject<InternalTaskInstance & Timestamps>().status as TaskInstanceStatus;
    } else {
      logger.info(`Mongodb doesn't find task instance ${taskInstanceId} status`);
      return undefined;
    }
  }

  async listTaskInstances(request: ListTaskInstancesInput): Promise<TaskInstance[]> {
    logger.info(`Mongodb lists task instance on task ${request.taskId} version ${request.version} status ${request.status}`);
    const query: any = {};
    typeof request.taskId === 'string' ? (query['taskId'] = request.taskId) : 0;
    typeof request.version === 'number' ? (query['version'] = request.version) : 0;
    typeof request.status === 'string' ? (query['status'] = request.status) : 0;

    if (typeof request.from === 'number' || typeof request.to === 'number') {
      const creationQuery: any = {};
      if (typeof request.from === 'number') {
        creationQuery['$gte'] = new Date(request.from);
      }
      if (typeof request.to === 'number') {
        creationQuery['$lt'] = new Date(request.to);
      }
      query['updatedAt'] = creationQuery;
    }

    const instances = await TaskInstanceSchema.find(query).exec();

    return instances.map((i) => this.convertInternalTaskInstanceToTaskInstance(i.toObject<InternalTaskInstance & Timestamps>()));
  }

  private convertInternalTaskToTask(internalTask: InternalTask & Timestamps): Task {
    if (internalTask.type === 'job') {
      const blob: any = JSON.parse(internalTask.blob);
      const job: Job = {
        taskId: internalTask.taskId,
        version: internalTask.version,
        createdAt: internalTask.createdAt.getTime(),
        lastUpdatedAt: internalTask.updatedAt.getTime(),
        name: internalTask.name,
        description: internalTask.description,
        type: 'job',
        cmd: internalTask.cmd,
        cwd: internalTask.cwd,
        stdout: internalTask.stdout,
        stderr: internalTask.stderr,
        arguments: blob.arguments,
        env: blob.env,
        duration: internalTask.duration,
        firstLaunchAt: internalTask.firstLaunchAt,
      };
      return job;
    } else if (internalTask.type === 'service') {
      const blob: any = JSON.parse(internalTask.blob);
      const service: Service = {
        taskId: internalTask.taskId,
        version: internalTask.version,
        createdAt: internalTask.createdAt.getTime(),
        lastUpdatedAt: internalTask.updatedAt.getTime(),
        name: internalTask.name,
        description: internalTask.description,
        type: 'service',
        cmd: internalTask.cmd,
        cwd: internalTask.cwd,
        stdout: internalTask.stdout,
        stderr: internalTask.stderr,
        arguments: blob.arguments,
        env: blob.env,
        healthCheck: blob.healthCheck,
      };
      return service;
    } else {
      const message = `Invalid task type ${internalTask.type} found in mongodb.`;
      logger.warn(message);
      throw new InternalServiceError(message);
    }
  }

  private convertInternalTaskInstanceToTaskInstance(obj: InternalTaskInstance & Timestamps): TaskInstance {
    return {
      taskId: obj.taskId,
      taskVersion: obj.version,
      instanceId: obj.instanceId,
      agentId: obj.agentId,
      pid: obj.pid,
      status: obj.status as TaskInstanceStatus,
      createdAt: obj.createdAt.getTime(),
      lastUpdatedAt: obj.updatedAt.getTime(),
    };
  }

  async createTaskInstance(internalInstance: InternalTaskInstance): Promise<void> {
    logger.info(`Mongodb creates internal task instance ${internalInstance.instanceId} for task ${internalInstance.taskId} version ${internalInstance.version}`);
    try {
      await TaskInstanceSchema.create(internalInstance);
    } catch (err: any) {
      if (err.code === 11000) {
        const message = `Task instance ${internalInstance.instanceId} already existed in mongodb.`;
        logger.error(message);
        throw new InternalServiceError(message);
      }
      throw err;
    }
  }

  async updateTaskInstanceStatus(instanceId: string, status: string): Promise<void> {
    logger.info(`Mongodb updates task instance ${instanceId} status to ${status}`);
    await TaskInstanceSchema.findOneAndUpdate({ instanceId: instanceId }, { status: status }, { upsert: false }).exec();
  }

  async setTaskInstancePid(instanceId: string, pid: number): Promise<void> {
    logger.info(`Mongodb set task instance ${instanceId} pid to ${pid}`);
    await TaskInstanceSchema.findOneAndUpdate({ instanceId: instanceId }, { pid: pid }, { upsert: false }).exec();
  }

  async addTaskEvent(event: InternalTaskEvent): Promise<void> {
    logger.info(`Mongodb add task event ${event.eventId} status task instance ${event.instanceId}`);
    try {
      await TaskEventSchema.create(event);
    } catch (err: any) {
      if (err.code === 11000) {
        const message = `Task event ${event.eventId} already existed in mongodb.`;
        logger.error(message);
        // caller, we, guarantee event is unique.
        throw new InternalServiceError(message);
      }
      throw err;
    }
  }

  async listTaskEvents(instanceId: string): Promise<TaskEvent[]> {
    logger.info(`Mongodb lists task event on task instance ${instanceId}`);
    const events = await TaskEventSchema.find({ instanceId: instanceId }).exec();
    return events.map((i) => this.convertInternalTaskEventToTaskEvent(i.toObject<InternalTaskEvent>()));
  }

  private convertInternalTaskEventToTaskEvent(obj: InternalTaskEvent): TaskEvent {
    let _payload: any = obj.payload;
    if (obj.format === 'json') {
      try {
        _payload = JSON.parse(_payload);
      } catch (err: any) {
        const message = 'Failed to deserialize task event json payload.';
        logger.error(message);
        throw new InternalServiceError(message);
      }
    }
    return {
      instanceId: obj.instanceId,
      eventId: obj.eventId,
      source: obj.source as TaskEventSource,
      timestamp: obj.timestamp.getTime(),
      level: obj.level as TaskEventLevel,
      format: obj.format as TaskEventFormat,
      payload: _payload,
    };
  }
}

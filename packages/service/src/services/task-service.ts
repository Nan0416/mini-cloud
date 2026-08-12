import {
  ConflictError,
  CreateTaskRequest,
  CreateTaskResponse,
  LoggerFactory,
  NotFoundError,
  ReplacementVariables,
  Task,
  TaskDynamics,
  TaskIdentifier,
  TaskIdentifierWithHealthCheck,
  UpdateTaskRequest,
  UpdateTaskResponse,
} from '@mini-cloud/shared';
import { CreateTaskVersionInput, TaskDao } from '../data/task-dao';
import { TaskDynamicsDao } from '../data/task-dynamics-dao';
import { VariableDao } from '../data/variable-dao';
import { generateTaskId } from '../utils/ids';

const logger = LoggerFactory.getLogger('TaskService');

export interface TaskServiceProps {
  readonly taskDao: TaskDao;
  readonly taskDynamicsDao: TaskDynamicsDao;
  readonly variableDao: VariableDao;
}

/** Task definitions, their versions, their schedule state and the variable table. */
export class TaskService {
  private readonly taskDao: TaskDao;
  private readonly taskDynamicsDao: TaskDynamicsDao;
  private readonly variableDao: VariableDao;

  constructor(props: TaskServiceProps) {
    this.taskDao = props.taskDao;
    this.taskDynamicsDao = props.taskDynamicsDao;
    this.variableDao = props.variableDao;
  }

  async createTask(request: CreateTaskRequest): Promise<CreateTaskResponse> {
    const taskId = generateTaskId();
    logger.info(`Creating ${request.type} task "${request.name}" as ${taskId}.`);
    await this.taskDao.createTaskVersion(this.toCreateInput(request, taskId, 1));
    return { taskId, version: 1 };
  }

  async updateTask(request: UpdateTaskRequest): Promise<UpdateTaskResponse> {
    const current = await this.taskDao.getLatestTask(request.taskId);
    if (current === null) {
      throw new NotFoundError(`Task ${request.taskId} does not exist.`);
    }
    if (current.type !== request.type) {
      // A job and a service have different lifecycles; changing between them would
      // orphan running instances that were launched under the old semantics.
      throw new ConflictError(`Task ${request.taskId} is a ${current.type} and cannot be changed into a ${request.type}. Delete it and create a new task instead.`);
    }

    const version = current.version + 1;
    logger.info(`Updating task ${request.taskId} to version ${version}.`);
    await this.taskDao.createTaskVersion(this.toCreateInput(request, request.taskId, version));
    return { taskId: request.taskId, version };
  }

  async deleteTask(taskId: string): Promise<void> {
    const existing = await this.taskDao.getLatestVersionNumber(taskId);
    if (existing === null) {
      throw new NotFoundError(`Task ${taskId} does not exist.`);
    }
    // Instances outlive the task on purpose: their history stays readable until
    // retention prunes it.
    await this.taskDao.deleteTask(taskId);
  }

  async getTask(taskId: string, version?: number): Promise<Task> {
    const task = version === undefined ? await this.taskDao.getLatestTask(taskId) : await this.taskDao.getTaskVersion(taskId, version);
    if (task === null) {
      throw new NotFoundError(version === undefined ? `Task ${taskId} does not exist.` : `Task ${taskId} version ${version} does not exist.`);
    }
    return task;
  }

  async listTasks(): Promise<ReadonlyArray<Task>> {
    return this.taskDao.listLatestTasks();
  }

  /**
   * Dynamics are created lazily: a task that has never been scheduled has no row,
   * and reading it materialises the defaults rather than returning null.
   */
  async getDynamics(taskId: string): Promise<TaskDynamics> {
    const existing = await this.taskDynamicsDao.getDynamics(taskId);
    if (existing !== null) {
      return existing;
    }
    await this.assertTaskExists(taskId);
    return { taskId, active: false, targetAgentIds: [] };
  }

  async setActive(taskId: string, active: boolean): Promise<TaskDynamics> {
    await this.assertTaskExists(taskId);
    logger.info(`Setting task ${taskId} active=${active}.`);
    return this.taskDynamicsDao.setActive(taskId, active);
  }

  async setTargetAgents(taskId: string, targetAgentIds: ReadonlyArray<string>): Promise<TaskDynamics> {
    await this.assertTaskExists(taskId);
    logger.info(`Setting task ${taskId} target agents to [${targetAgentIds.join(', ')}].`);
    return this.taskDynamicsDao.setTargetAgents(taskId, targetAgentIds);
  }

  async listHealthChecks(identifiers: ReadonlyArray<TaskIdentifier>): Promise<ReadonlyArray<TaskIdentifierWithHealthCheck>> {
    return this.taskDao.listHealthChecks(identifiers);
  }

  async listVariables(): Promise<ReplacementVariables> {
    return this.variableDao.listVariables();
  }

  async setVariables(variables: ReplacementVariables): Promise<ReplacementVariables> {
    logger.info(`Replacing the replacement-variable set with ${Object.keys(variables).length} entries.`);
    return this.variableDao.replaceVariables(variables);
  }

  private async assertTaskExists(taskId: string): Promise<void> {
    const version = await this.taskDao.getLatestVersionNumber(taskId);
    if (version === null) {
      throw new NotFoundError(`Task ${taskId} does not exist.`);
    }
  }

  private toCreateInput(request: CreateTaskRequest | UpdateTaskRequest, taskId: string, version: number): CreateTaskVersionInput {
    const base = {
      taskId,
      version,
      name: request.name,
      description: request.description,
      cmd: request.cmd,
      cwd: request.cwd,
      arguments: request.arguments,
      env: request.env,
      stdout: request.stdout,
      stderr: request.stderr,
    };

    if (request.type === 'job') {
      return { ...base, type: 'job', durationMs: request.duration, firstLaunchAt: request.firstLaunchAt };
    }
    return { ...base, type: 'service', healthCheck: request.healthCheck };
  }
}

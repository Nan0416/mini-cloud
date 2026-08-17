import {
  ConflictError,
  CreateTaskRequest,
  CreateTaskResponse,
  DeleteTaskRequest,
  DeleteTaskResponse,
  GetTaskDynamicsRequest,
  GetTaskDynamicsResponse,
  GetTaskInstanceRequest,
  GetTaskInstanceResponse,
  GetTaskRequest,
  GetTaskResponse,
  InvalidRequestError,
  LaunchTaskRequest,
  LaunchTaskResponse,
  ListHealthChecksRequest,
  ListHealthChecksResponse,
  ListReplacementVariablesRequest,
  ListReplacementVariablesResponse,
  ListTaskEventsRequest,
  ListTaskEventsResponse,
  ListTaskInstancesRequest,
  ListTaskInstancesResponse,
  ListTasksRequest,
  ListTasksResponse,
  LoggerFactory,
  NotFoundError,
  ReportInstancePidRequest,
  ReportInstancePidResponse,
  ReportInstanceStatusRequest,
  ReportInstanceStatusResponse,
  ReportTaskEventRequest,
  ReportTaskEventResponse,
  SetReplacementVariablesRequest,
  SetReplacementVariablesResponse,
  SetTaskActiveRequest,
  SetTaskActiveResponse,
  SetTaskTargetAgentsRequest,
  SetTaskTargetAgentsResponse,
  TERMINATION_PERMITTED_STATUSES,
  TaskEventLevel,
  TaskInstanceStatus,
  TerminateTaskInstanceRequest,
  TerminateTaskInstanceResponse,
  UpdateTaskRequest,
  UpdateTaskResponse,
} from '@mini-cloud/shared';
import { CreateTaskVersionInput, TaskDao } from '../data/task-dao';
import { TaskDynamicsDao } from '../data/task-dynamics-dao';
import { TaskEventDao } from '../data/task-event-dao';
import { TaskInstanceDao } from '../data/task-instance-dao';
import { VariableDao } from '../data/variable-dao';
import { AgentCommander } from '../facades/agent-commander';
import { TaskDispatcher } from '../facades/task-dispatcher';
import { generateEventId, generateTaskId } from '../utils/ids';

const logger = LoggerFactory.getLogger('TaskService');

/** How many events a listing returns when the caller does not say. */
const DEFAULT_EVENT_LIMIT = 500;

export interface TaskServiceProps {
  readonly taskDao: TaskDao;
  readonly taskDynamicsDao: TaskDynamicsDao;
  readonly taskInstanceDao: TaskInstanceDao;
  readonly taskEventDao: TaskEventDao;
  readonly variableDao: VariableDao;
  readonly agentCommander: AgentCommander;
  readonly taskDispatcher: TaskDispatcher;
}

/**
 * Everything in the task domain: definitions and their versions, the schedule state
 * and variable table they resolve against, the instances they launch into, and the
 * event log those instances write.
 *
 * Every public method takes one Request and returns one Response, including the ones
 * no HTTP route exposes, so an operation gaining a field never changes a signature.
 */
export class TaskService {
  private readonly taskDao: TaskDao;
  private readonly taskDynamicsDao: TaskDynamicsDao;
  private readonly taskInstanceDao: TaskInstanceDao;
  private readonly taskEventDao: TaskEventDao;
  private readonly variableDao: VariableDao;
  private readonly agentCommander: AgentCommander;
  private readonly taskDispatcher: TaskDispatcher;

  constructor(props: TaskServiceProps) {
    this.taskDao = props.taskDao;
    this.taskDynamicsDao = props.taskDynamicsDao;
    this.taskInstanceDao = props.taskInstanceDao;
    this.taskEventDao = props.taskEventDao;
    this.variableDao = props.variableDao;
    this.agentCommander = props.agentCommander;
    this.taskDispatcher = props.taskDispatcher;
  }

  // ---------------------------------------------------------------------------
  // Task definitions
  // ---------------------------------------------------------------------------

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

  async deleteTask(request: DeleteTaskRequest): Promise<DeleteTaskResponse> {
    const existing = await this.taskDao.getLatestVersionNumber(request.taskId);
    if (existing === null) {
      throw new NotFoundError(`Task ${request.taskId} does not exist.`);
    }
    // Instances outlive the task on purpose: their history stays readable until
    // retention prunes it.
    await this.taskDao.deleteTask(request.taskId);
    return {};
  }

  async getTask(request: GetTaskRequest): Promise<GetTaskResponse> {
    const { taskId, version } = request;
    const task = version === undefined ? await this.taskDao.getLatestTask(taskId) : await this.taskDao.getTaskVersion(taskId, version);
    if (task === null) {
      throw new NotFoundError(version === undefined ? `Task ${taskId} does not exist.` : `Task ${taskId} version ${version} does not exist.`);
    }
    return { task };
  }

  async listTasks(_request: ListTasksRequest = {}): Promise<ListTasksResponse> {
    return { tasks: await this.taskDao.listLatestTasks() };
  }

  async listHealthChecks(request: ListHealthChecksRequest): Promise<ListHealthChecksResponse> {
    return { healthChecks: await this.taskDao.listHealthChecks(request.taskIdentifiers) };
  }

  // ---------------------------------------------------------------------------
  // Schedule state and replacement variables
  // ---------------------------------------------------------------------------

  /**
   * Dynamics are created lazily: a task that has never been scheduled has no row,
   * and reading it materialises the defaults rather than returning null.
   */
  async getDynamics(request: GetTaskDynamicsRequest): Promise<GetTaskDynamicsResponse> {
    const existing = await this.taskDynamicsDao.getDynamics(request.taskId);
    if (existing !== null) {
      return { dynamics: existing };
    }
    await this.assertTaskExists(request.taskId);
    return { dynamics: { taskId: request.taskId, active: false, targetAgentIds: [] } };
  }

  async setActive(request: SetTaskActiveRequest): Promise<SetTaskActiveResponse> {
    const { taskId, active } = request;
    await this.assertTaskExists(taskId);
    logger.info(`Setting task ${taskId} active=${active}.`);
    return { dynamics: await this.taskDynamicsDao.setActive(taskId, active) };
  }

  async setTargetAgents(request: SetTaskTargetAgentsRequest): Promise<SetTaskTargetAgentsResponse> {
    const { taskId, targetAgentIds } = request;
    await this.assertTaskExists(taskId);
    logger.info(`Setting task ${taskId} target agents to [${targetAgentIds.join(', ')}].`);
    return { dynamics: await this.taskDynamicsDao.setTargetAgents(taskId, targetAgentIds) };
  }

  async listVariables(_request: ListReplacementVariablesRequest = {}): Promise<ListReplacementVariablesResponse> {
    return { variables: await this.variableDao.listVariables() };
  }

  async setVariables(request: SetReplacementVariablesRequest): Promise<SetReplacementVariablesResponse> {
    logger.info(`Replacing the replacement-variable set with ${Object.keys(request.variables).length} entries.`);
    return { variables: await this.variableDao.replaceVariables(request.variables) };
  }

  // ---------------------------------------------------------------------------
  // Task instances
  // ---------------------------------------------------------------------------

  async getInstance(request: GetTaskInstanceRequest): Promise<GetTaskInstanceResponse> {
    const instance = await this.taskInstanceDao.getInstance(request.instanceId);
    if (instance === null) {
      throw new NotFoundError(`Task instance ${request.instanceId} does not exist.`);
    }
    return { instance };
  }

  async listInstances(request: ListTaskInstancesRequest = {}): Promise<ListTaskInstancesResponse> {
    return { instances: await this.taskInstanceDao.listInstances(request) };
  }

  /**
   * Applies a status if it does not move the instance backwards.
   *
   * A rejected update is normal, not an error: reports race over the network and the
   * older one loses, so the caller is told nothing beyond the instance existing.
   */
  async recordStatus(request: ReportInstanceStatusRequest): Promise<ReportInstanceStatusResponse> {
    const result = await this.taskInstanceDao.updateStatus(request.instanceId, request.status);
    if (!result.found) {
      throw new NotFoundError(`Task instance ${request.instanceId} does not exist.`);
    }
    return {};
  }

  async recordPid(request: ReportInstancePidRequest): Promise<ReportInstancePidResponse> {
    const { instanceId, pid } = request;
    const updated = await this.taskInstanceDao.setPid(instanceId, pid);
    if (!updated) {
      throw new NotFoundError(`Task instance ${instanceId} does not exist.`);
    }
    logger.info(`Instance ${instanceId} is running as pid ${pid}.`);
    return {};
  }

  // ---------------------------------------------------------------------------
  // Instance event log
  // ---------------------------------------------------------------------------

  async addEvent(request: ReportTaskEventRequest): Promise<ReportTaskEventResponse> {
    await this.taskEventDao.createEvent({ ...request, eventId: generateEventId() });
    return {};
  }

  async listEvents(request: ListTaskEventsRequest): Promise<ListTaskEventsResponse> {
    return { events: await this.taskEventDao.listEvents(request.instanceId, request.limit ?? DEFAULT_EVENT_LIMIT) };
  }

  // ---------------------------------------------------------------------------
  // Launching and termination
  // ---------------------------------------------------------------------------

  /** Manual launch. Falls back to the task's configured agents when none are given. */
  async launchTask(request: LaunchTaskRequest): Promise<LaunchTaskResponse> {
    const { taskId, targetAgentIds, arguments: extraArguments } = request;
    const { task } = await this.getTask({ taskId });
    const agentIds = targetAgentIds ?? (await this.getDynamics({ taskId })).dynamics.targetAgentIds;
    if (agentIds.length === 0) {
      throw new InvalidRequestError(`Task ${taskId} has no target agents. Pass targetAgentIds or configure them on the task first.`);
    }
    const { variables } = await this.listVariables();
    return this.taskDispatcher.dispatch({ task, agentIds, variables, extraArguments });
  }

  async terminateInstance(request: TerminateTaskInstanceRequest): Promise<TerminateTaskInstanceResponse> {
    const { instanceId } = request;
    const { instance } = await this.getInstance({ instanceId });

    if (!TERMINATION_PERMITTED_STATUSES.includes(instance.status)) {
      throw new ConflictError(`Instance ${instanceId} is "${instance.status}" and is not running.`);
    }
    if (instance.pid === undefined) {
      // The agent spawns detached, so the pid it can signal is the one the task
      // reported for itself. Without it there is nothing to send SIGINT to.
      throw new ConflictError(`Instance ${instanceId} has not reported a pid yet, so it cannot be terminated. Wait for it to reach "running".`);
    }

    const delivered = this.agentCommander.terminateInstance(instance.agentId, instanceId, instance.pid);
    if (delivered > 0) {
      const message = `Sent terminate command for pid ${instance.pid} to agent ${instance.agentId}.`;
      await this.recordStatusWithEvent(instanceId, 'termination_initiated', 'success', message);
      return {};
    }

    const message = `Agent ${instance.agentId} is not connected, so the terminate command could not be delivered.`;
    await this.recordStatusWithEvent(instanceId, 'termination_failed', 'error', message);
    throw new ConflictError(message);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Records a status change and the event explaining it.
   *
   * Goes to the DAOs rather than through `recordStatus`, because the statuses a
   * termination moves through are the service's to assign and sit outside the set an
   * agent is allowed to report.
   */
  private async recordStatusWithEvent(instanceId: string, status: TaskInstanceStatus, level: TaskEventLevel, message: string): Promise<void> {
    await this.taskInstanceDao.updateStatus(instanceId, status);
    await this.taskEventDao.createEvent({
      eventId: generateEventId(),
      instanceId,
      source: 'service',
      level,
      payload: message,
      timestamp: Date.now(),
    });
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

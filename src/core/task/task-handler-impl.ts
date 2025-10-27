import { LoggerFactory } from '@sparrow/logging-js';
import {
  Task,
  Job,
  AgentStatus,
  TaskInstanceStatus,
  TaskEventLevel,
  TaskInstance,
  LaunchTaskInstanceResult,
  TaskAgent,
  IssueClient,
  ResetReplacementVariablesRequest,
  ResetReplacementVariablesResponse,
  ListReplacementVariablesRequest,
  ListReplacementVariablesResponse,
  CreateTaskRequest,
  CreateTaskResponse,
  UpdateTaskRequest,
  UpdateTaskResponse,
  ReportTaskEventRequest,
  ReportTaskEventReponse,
  ReportTaskInstanceStatusRequest,
  ReportTaskInstancePidRequest,
  ReportTaskInstancePidResponse,
  ReportAgentStatusRequest,
  ReportAgentStatusResponse,
  LaunchTaskRequest,
  LaunchTaskResponse,
  TerminateTaskAgentRequest,
  TerminateTaskAgentResponse,
  TerminateTaskInstanceRequest,
  TerminateTaskInstanceResponse,
  InvalidRequestError,
  ListTaskAgentsRequest,
  ListTaskAgentsResponse,
  ReportTaskInstanceStatusResponse,
  DeleteTaskRequest,
  DeleteTaskResponse,
  GetTaskDynamicsRequest,
  GetTaskDynamicsResponse,
  GetTaskInstanceRequest,
  GetTaskInstanceResponse,
  GetTaskRequest,
  GetTaskResponse,
  ListHealthChecksRequest,
  ListHealthChecksResponse,
  ListRunningInstancesRequest,
  ListRunningInstancesResponse,
  ListTaskEventsRequest,
  ListTaskEventsResponse,
  ListTaskInstancesRequest,
  ListTaskInstancesResponse,
  ListTasksRequest,
  ListTasksResponse,
  ResetTaskActiveRequest,
  ResetTaskActiveResponse,
  ResetTaskTargetAgentsRequest,
  ResetTaskTargetAgentsResponse,
} from '../../models';
import { TaskStatusWatcher } from './task-status-watcher';
import { TERMINATION_PERMITTED_STATUSES } from './utilities';
import { TaskAccessor } from './task-accessor';
import { VariableManager } from './variable-manager';
import { TaskHandler } from '../../handlers/task-handler';
import { TaskAgentRequestBroadcaster } from '../../models/clients/task-agent-client';

const logger = LoggerFactory.getLogger('TaskManagerImpl');

interface InternalTaskAgent extends TaskAgent {
  lastPingAt: number;
  status: AgentStatus;
  name: string;
}
export interface TaskManagerProps {
  readonly taskAccessor: TaskAccessor;
  readonly taskAgentRequestBroadcaster: TaskAgentRequestBroadcaster;
  readonly variableManager: VariableManager;
  readonly agentList: TaskAgent[];
  readonly issueClient: IssueClient;
}

// must be less then task watcher timeout configuration.
const PERIOD_TASK_DURATION = 5_000;
export class TaskHandlerImpl implements TaskHandler {
  private readonly taskAccessor: TaskAccessor;
  private readonly taskAgentRequestBroadcaster: TaskAgentRequestBroadcaster;
  private readonly variableManager: VariableManager;
  private readonly issueClient: IssueClient;
  private readonly agentList: InternalTaskAgent[];
  private statusMonitorHandle?: NodeJS.Timeout;
  private jobRunner?: NodeJS.Timeout;
  private jobWindowStartTime?: number;
  private readonly taskStatusWatcher: TaskStatusWatcher;

  constructor(props: TaskManagerProps) {
    this.taskAccessor = props.taskAccessor;
    this.taskAgentRequestBroadcaster = props.taskAgentRequestBroadcaster;
    this.variableManager = props.variableManager;
    this.agentList = props.agentList.map((agent) => ({ ...agent, lastPingAt: 0 }));
    this.issueClient = props.issueClient;
    this.taskStatusWatcher = new TaskStatusWatcher({
      launchingTimeout: 15_000,
      startTimeout: 60_000, // some task may be slow.
    });
  }

  async init(): Promise<void> {
    logger.info('Start agent and task instance status monitoring.');
    this.statusMonitorHandle = setInterval(() => {
      const referenceTime = Date.now();
      this.requireAgentStatus();
      this.expireAgents(referenceTime - 10_000);
      this.checkInstanceStatusTimeouts(referenceTime);
    }, PERIOD_TASK_DURATION);

    this.jobRunner = setInterval(() => {
      if (this.jobWindowStartTime === undefined) {
        this.jobWindowStartTime = Date.now();
      } else {
        const endTime = Date.now();
        const window: [number, number] = [this.jobWindowStartTime, endTime];
        this.launchJobs(window).catch((err: any) => {
          logger.error(`Failed to run jobs for window [${new Date(window[0]).toISOString()}, ${new Date(window[1]).toISOString()}).`, err);
        });
        this.jobWindowStartTime = endTime;
      }
    }, 1_000);
  }

  async terminate(): Promise<void> {
    if (this.statusMonitorHandle) {
      logger.info('Terminate agent and task instance status monitoring.');
      clearInterval(this.statusMonitorHandle);
      this.statusMonitorHandle = undefined;
    }

    if (this.jobRunner) {
      logger.info('Terminate job runner.');
      clearInterval(this.jobRunner);
      this.jobRunner = undefined;
    }
  }

  async createTask(request: CreateTaskRequest): Promise<CreateTaskResponse> {
    logger.info(`Create task ${request.name}`);
    const output = await this.taskAccessor.createTask(request);
    return output;
  }

  async updateTask(request: UpdateTaskRequest): Promise<UpdateTaskResponse> {
    logger.info(`Update task ${request.taskId} ${request.name}`);
    const output = await this.taskAccessor.updateTask(request);
    return output;
  }

  async deleteTask(request: DeleteTaskRequest): Promise<DeleteTaskResponse> {
    logger.info(`Delete task ${request.taskId}`);
    const output = await this.taskAccessor.deleteTask(request);
    return output;
  }

  async getTask(request: GetTaskRequest): Promise<GetTaskResponse> {
    return this.taskAccessor.getTask(request);
  }

  async getTaskDynamics(request: GetTaskDynamicsRequest): Promise<GetTaskDynamicsResponse> {
    return this.taskAccessor.getTaskDynamics(request);
  }

  async resetTaskActive(request: ResetTaskActiveRequest): Promise<ResetTaskActiveResponse> {
    return this.taskAccessor.resetTaskActive(request);
  }

  async resetTaskTargetAgents(request: ResetTaskTargetAgentsRequest): Promise<ResetTaskTargetAgentsResponse> {
    return this.taskAccessor.resetTaskTargetAgents(request);
  }

  async listTasks(request: ListTasksRequest): Promise<ListTasksResponse> {
    return this.taskAccessor.listLatestTasks(request);
  }

  async getTaskInstance(request: GetTaskInstanceRequest): Promise<GetTaskInstanceResponse> {
    return this.taskAccessor.getTaskInstance(request);
  }

  async listTaskInstances(request: ListTaskInstancesRequest): Promise<ListTaskInstancesResponse> {
    return this.taskAccessor.listTaskInstances(request);
  }

  async listTaskEvents(request: ListTaskEventsRequest): Promise<ListTaskEventsResponse> {
    return this.taskAccessor.listTaskEvents(request);
  }

  async listRunningInstances(request: ListRunningInstancesRequest): Promise<ListRunningInstancesResponse> {
    return this.taskAccessor.listTaskInstances({
      agentId: request.agentId,
      status: 'running',
    });
  }

  async listHealthChecks(request: ListHealthChecksRequest): Promise<ListHealthChecksResponse> {
    return this.taskAccessor.listHealthChecks(request);
  }

  async resetReplacementVariables(request: ResetReplacementVariablesRequest): Promise<ResetReplacementVariablesResponse> {
    logger.info('Reset replacement variables.');
    await this.variableManager.reset(request.variables);
    return {
      message: 'success',
    };
  }

  async listReplacementVariables(request: ListReplacementVariablesRequest): Promise<ListReplacementVariablesResponse> {
    logger.info('List replacement variables.');
    const variables = await this.variableManager.list();
    return {
      variables: variables,
    };
  }

  async reportTaskEvent(request: ReportTaskEventRequest): Promise<ReportTaskEventReponse> {
    logger.info(`Handle agent task event report request ${request.taskInstanceId} ${request.level} event.`);
    // NewTaskEvent and AddTaskEventRequest have the same shape.
    await this.taskAccessor.addTaskEvent(request);
    return {};
  }

  async reportTaskInstanceStatus(request: ReportTaskInstanceStatusRequest): Promise<ReportTaskInstanceStatusResponse> {
    logger.info(`Handle agent task instance status report request ${request.taskInstanceId} status ${request.status}.`);

    this.taskStatusWatcher.watch(request.taskInstanceId, request.status, Date.now());
    await this.taskAccessor.updateTaskInstanceStatus({
      taskInstanceId: request.taskInstanceId,
      status: request.status,
    });
    if (request.status === 'health_check_failure' || request.status === 'exit(1)') {
      logger.info(`Task instance ${request.taskInstanceId} has abnormal status ${request.status}.`);
      const { taskInstance } = await this.taskAccessor.getTaskInstance({ taskInstanceId: request.taskInstanceId });
      const { task } = await this.taskAccessor.getTask({
        taskId: taskInstance.taskId,
        version: taskInstance.taskVersion,
      });
      await this.createIssue(task, taskInstance, request.status);
    }

    return {};
  }

  private async createIssue(task: Task, taskInstance: TaskInstance, status: 'health_check_failure' | 'exit(1)') {
    try {
      // task service can start runing before issue service is running, so it could potentially throw error.
      logger.info(`Create issue for task instance ${taskInstance.instanceId} due to its status ${status}.`);
      const message = `Task instance ${taskInstance.instanceId} at agent ${taskInstance.agentId} failed code ${status};\nTask ${task.name} taskId ${task.taskId} version ${task.version}.`;
      await this.issueClient.createIssue({
        category: 'TasksService',
        type: task.type,
        severity: 2,
        title: `Task instance ${task.name} has abnormal status ${status}.`,
        description: message,
        deduplicationToken: `instance-${taskInstance.instanceId}`,
      });
    } catch (err) {
      logger.warn(`Failed to create issue for instance ${taskInstance.instanceId}.`, err);
    }
  }

  async reportTaskInstancePid(request: ReportTaskInstancePidRequest): Promise<ReportTaskInstancePidResponse> {
    logger.info(`Handle agent task instance pid report request ${request.taskInstanceId} pid ${request.pid}.`);
    await this.taskAccessor.setTaskInstancPid({
      taskInstanceId: request.taskInstanceId,
      pid: request.pid,
    });
    return {};
  }

  async reportAgentStatus(request: ReportAgentStatusRequest): Promise<ReportAgentStatusResponse> {
    logger.info(`Handle agent status refresh request ${request.agentId}`);
    const agent = this.agentList.find((a) => a.identifier === request.agentId);
    if (agent) {
      agent.lastPingAt = Date.now();
      agent.status = 'online'; // in case it was changed to offline, now make it online.
      if (typeof request.name === 'string') {
        agent.name = request.name;
      }
    } else {
      logger.info(`Add new agent ${request.agentId} ${request.name} to agent list.`);
      this.agentList.push({
        identifier: request.agentId,
        status: 'online',
        name: typeof request.name === 'string' ? request.name : request.agentId,
        lastPingAt: Date.now(),
      });
    }

    return {};
  }

  async launchTask(request: LaunchTaskRequest): Promise<LaunchTaskResponse> {
    logger.info(`Launch task ${request.taskId} on agents ${request.targetAgentIds.join(', ')} with arguments ${request.arguments?.join(', ')}.`);
    let { task } = await this.taskAccessor.getTask({ taskId: request.taskId });
    task = request.arguments !== undefined ? this.addAdditionalArguments(task, request.arguments) : task;
    const results = await this.internalLaunchTask(task, request.targetAgentIds);
    return {
      results: results,
    };
  }

  private addAdditionalArguments(task: Task, arguments_: string[]): Task {
    return {
      ...task,
      arguments: task.arguments ? task.arguments.concat(arguments_) : arguments_,
    };
  }

  async terminateTaskInstance(request: TerminateTaskInstanceRequest): Promise<TerminateTaskInstanceResponse> {
    logger.info(`Terminate task instance ${request.taskInstanceId}.`);
    const { taskInstance } = await this.taskAccessor.getTaskInstance({ taskInstanceId: request.taskInstanceId });

    if (TERMINATION_PERMITTED_STATUSES.includes(taskInstance.status) && typeof taskInstance.pid === 'number') {
      await this.taskAgentRequestBroadcaster.send({
        agentId: taskInstance.agentId,
        type: 'terminate-task-instance',
        request: {
          taskInstanceId: taskInstance.instanceId,
          pid: taskInstance.pid,
        },
      });
      const message = `Successfully initiated termination on task instance ${taskInstance.instanceId} pid ${taskInstance.pid}.`;
      logger.info(message);
      await this.addInstanceStatusAndEvent(taskInstance.instanceId, 'termination_initiated', 'success', message);
    } else {
      let message = `Failed to terminate task instance ${request.taskInstanceId}.`;
      if (taskInstance.status !== 'running') {
        message = `Failed to terminate task instance ${request.taskInstanceId} because its current status is ${taskInstance.status} not "running".`;
      } else if (taskInstance.pid === undefined) {
        message = `Failed to terminate task instance ${request.taskInstanceId} because of unknown pid.`;
      }
      logger.warn(message);
      throw new InvalidRequestError(message);
    }

    return {};
  }

  async listTaskAgents(request: ListTaskAgentsRequest): Promise<ListTaskAgentsResponse> {
    logger.info(`List task agents.`);
    const agents = this.agentList.map((agent) => this.convertInternalAgentToAgent(agent));
    return {
      agents: agents,
    };
  }

  async terminateTaskAgent(request: TerminateTaskAgentRequest): Promise<TerminateTaskAgentResponse> {
    logger.info(`Terminate task agent ${request.agentId}.`);
    const agent = this.agentList.find((agent) => agent.identifier === request.agentId);
    if (agent?.status === 'online') {
      await this.taskAgentRequestBroadcaster.send({
        agentId: request.agentId,
        type: 'terminate-agent',
        request: {},
      });
      agent.status = 'offline';
    } else {
      logger.info(`Task agent ${request.agentId} doesn't exist or is offline.`);
    }

    return {};
  }

  /**
   * launch job if its derived next launch fall between window [number, number).
   * @param window
   */
  private async launchJobs(window: [number, number]): Promise<LaunchTaskInstanceResult[]> {
    logger.debug(`Launch jobs fall between ${new Date(window[0]).toISOString()} and ${new Date(window[1]).toISOString()}.`);
    const { tasks } = await this.taskAccessor.listLatestTasks({});
    const jobsToLaunch = tasks
      .filter((t) => t.type === 'job')
      .map((t) => t as Job)
      .filter((t) => {
        if (t.firstLaunchAt === undefined) {
          return false;
        } else if (window[0] <= t.firstLaunchAt && t.firstLaunchAt < window[1]) {
          return true;
        } else if (t.firstLaunchAt >= window[1]) {
          return false; // still in the future.
        } else if (t.duration !== undefined) {
          // t.firstLaunchAt < window[0]
          /**
           * example 1. firstLaunchAt = 6, window = [100, 103], duration = 5
           * next launch falls in the window is 6 + ceil((100 - 6)/5) * 5 = 101
           *
           * example 2. firstLaunchAt = 6, window = [100, 103], duration = 15
           * don't have a time fall in the window, 6 + ceil((100 - 6)/15) * 15 = 111
           *
           * example 4. firstLaunchAt = 5, window = [100, 103], duration = 5
           * don't have a time fall in the window, 5 + ceil((100 - 5)/5) * 5 = 100
           *
           * example 4. firstLaunchAt = 6, window = [100, 120], duration = 5
           * duration must be large or equal to the window size, otherwise, some run will be missed.
           * in this example, only 101 will run, and next run will be 121. It missed 106, 111, and 116.
           */
          const ratio = Math.ceil((window[0] - t.firstLaunchAt) / t.duration);
          const nextLaunchAt = ratio * t.duration + t.firstLaunchAt;
          return window[0] <= nextLaunchAt && nextLaunchAt < window[1];
        } else {
          return false;
        }
      });

    logger.debug(`Found ${jobsToLaunch.length} jobs fall between ${new Date(window[0]).toISOString()} and ${new Date(window[1]).toISOString()}.`);

    let results: LaunchTaskInstanceResult[] = [];
    for (let i = 0; i < jobsToLaunch.length; i++) {
      const { taskDynamics } = await this.taskAccessor.getTaskDynamics({ taskId: jobsToLaunch[i].taskId });
      if (taskDynamics.active) {
        const temp = await this.internalLaunchTask(jobsToLaunch[i], taskDynamics.targetAgentIds);
        results = results.concat(temp);
      }
    }
    return results;
  }

  private async internalLaunchTask(task: Task, targetAgentIds: string[]): Promise<LaunchTaskInstanceResult[]> {
    logger.info(`Launch task ${task.taskId} ${task.version} ${task.name}.`);
    const results: LaunchTaskInstanceResult[] = [];
    const destinationTask = await this.variableManager.replace(task);
    for (let i = 0; i < targetAgentIds.length; i++) {
      const agentId = targetAgentIds[i];
      logger.info(`Prepare task ${task.taskId} ${task.version} for agent ${agentId}.`);
      const { taskInstanceId } = await this.taskAccessor.createTaskInstance({
        taskId: destinationTask.taskId,
        version: destinationTask.version,
        agentId: agentId,
      });
      this.taskStatusWatcher.watch(taskInstanceId, 'init', Date.now());
      const agent = this.agentList.find((agent) => agent.identifier === agentId);

      let status: 'initiated' | 'initiation_failed';
      if (agent?.status === 'online') {
        logger.info(`Agent ${agentId} is online, sending launch request to it.`);

        await this.taskAgentRequestBroadcaster.send({
          agentId: agentId,
          type: 'launch-task-instance',
          request: {
            taskId: destinationTask.taskId,
            version: destinationTask.version,
            taskInstanceId: taskInstanceId,
            cmd: destinationTask.cmd,
            cwd: destinationTask.cwd,
            arguments: destinationTask.arguments,
            env: destinationTask.env,
            stdout: destinationTask.stdout,
            stderr: destinationTask.stderr,
            healthCheck: destinationTask.type === 'service' ? destinationTask.healthCheck : undefined,
          },
        });

        const message = `Initiated task ${task.taskId} ${task.version} at agent ${agentId}.`;
        logger.info(message);
        await this.addInstanceStatusAndEvent(taskInstanceId, 'initiated', 'success', message);
        status = 'initiated';
      } else {
        const message = `Failed to launch task ${task.taskId} ${task.version} at agent ${agentId} because agent is offline.`;
        logger.warn(message);
        await this.addInstanceStatusAndEvent(taskInstanceId, 'initiation_failed', 'error', message);
        status = 'initiation_failed';
      }

      results.push({
        taskId: task.taskId,
        taskVersion: task.version,
        instanceId: taskInstanceId,
        agentId: agentId,
        status: status,
      });
    }

    return results;
  }

  private async requireAgentStatus() {
    logger.debug(`Broadcast message to request agent status at ${new Date().toISOString()}.`);
    await this.taskAgentRequestBroadcaster.send({
      type: 'get-agent-status',
      request: {},
    });
  }

  private expireAgents(referenceTime: number) {
    logger.debug(`Set agent to inactive if the agent last ping is before ${new Date(referenceTime).toISOString()}.`);
    for (let i = 0; i < this.agentList.length; i++) {
      if (this.agentList[i].lastPingAt < referenceTime && this.agentList[i].status === 'online') {
        logger.info(`Set agent ${this.agentList[i].identifier} ${this.agentList[i].name} status to offline.`);
        this.agentList[i].status = 'offline';
      }
    }
  }

  private convertInternalAgentToAgent(agent: InternalTaskAgent): TaskAgent {
    return {
      identifier: agent.identifier,
      status: agent.status,
      name: agent.name,
    };
  }

  private async checkInstanceStatusTimeouts(referenceTime: number) {
    const timeouts = this.taskStatusWatcher.listTimeouts(referenceTime);
    for (let i = 0; i < timeouts.length; i++) {
      const message = `Task instance ${timeouts[i].instanceId} becomes ${timeouts[i].timeout}.`;
      logger.warn(message);
      // timeout model is a subset of task instance status;
      await this.addInstanceStatusAndEvent(timeouts[i].instanceId, timeouts[i].timeout, 'error', message);
    }
  }

  private async addInstanceStatusAndEvent(instanceId: string, status: TaskInstanceStatus, level: TaskEventLevel, message: string) {
    this.taskStatusWatcher.watch(instanceId, status, Date.now());
    await this.taskAccessor.updateTaskInstanceStatus({
      taskInstanceId: instanceId,
      status: status,
    });
    await this.taskAccessor.addTaskEvent({
      taskInstanceId: instanceId,
      source: 'task-service',
      timestamp: Date.now(),
      level: level,
      format: 'string',
      payload: message,
    });
  }
}

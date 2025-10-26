import { LoggerFactory } from '@sparrow/logging-js';
import {
  Task,
  Job,
  AgentSideTaskStatus,
  AgentStatus,
  NewTaskEvent,
  TaskInstanceStatus,
  TaskEventLevel,
  ReplacementVariables,
  TaskInstance,
  LaunchTaskInstanceResult,
  TaskAgent,
  IssueClient,
} from '../../models';
import { TaskStatusWatcher } from './task-status-watcher';
import { TERMINATION_PERMITTED_STATUSES } from './utilities';
import { EnhancedError, Errors } from '@sparrow/standard-error';
import { TaskFacade } from './task-facade';
import { AgentController } from './agent-controller';
import { VariableManager } from '../variable-manager';
import { TaskManager } from './task-manager';

const logger = LoggerFactory.getLogger('TaskManagerImpl');

interface InternalTaskAgent extends TaskAgent {
  lastPingAt: number;
  status: AgentStatus;
  name: string;
}
export interface TaskManagerProps {
  readonly taskFacade: TaskFacade;
  readonly agentController: AgentController;
  readonly variableManager: VariableManager;
  readonly agentList: TaskAgent[];
  readonly issueClient: IssueClient;
}

// must be less then task watcher timeout configuration.
const PERIOD_TASK_DURATION = 5_000;
export class TaskManagerImpl implements TaskManager {
  private readonly taskFacade: TaskFacade;
  private readonly agentController: AgentController;
  private readonly variableManager: VariableManager;
  private readonly issueClient: IssueClient;
  private readonly agentList: InternalTaskAgent[];
  private statusMonitorHandle?: NodeJS.Timeout;
  private jobRunner?: NodeJS.Timeout;
  private jobWindowStartTime?: number;
  private readonly taskStatusWatcher: TaskStatusWatcher;

  constructor(props: TaskManagerProps) {
    this.taskFacade = props.taskFacade;
    this.agentController = props.agentController;
    this.variableManager = props.variableManager;
    this.agentList = props.agentList.map((agent) => ({ ...agent, lastPingAt: 0 }));
    this.issueClient = props.issueClient;
    this.taskStatusWatcher = new TaskStatusWatcher({
      launchingTimeout: 15_000,
      startTimeout: 60_000, // some task may be slow.
    });
  }

  async resetReplacementVariables(variables: ReplacementVariables): Promise<void> {
    logger.info('Reset replacement variables.');
    await this.variableManager.reset(variables);
  }

  async listReplacementVariables(): Promise<ReplacementVariables> {
    logger.info('List replacement variables.');
    return await this.variableManager.list();
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

  async handleTaskEvent(event: NewTaskEvent): Promise<void> {
    logger.info(`Handle task instance ${event.instanceId} ${event.level} event.`);
    // NewTaskEvent and AddTaskEventRequest have the same shape.
    await this.taskFacade.addTaskEvent(event);
  }

  async handleTaskInstanceStatus(taskInstanceId: string, status: AgentSideTaskStatus): Promise<void> {
    logger.info(`Handle task instance ${taskInstanceId} status ${status}.`);

    this.taskStatusWatcher.watch(taskInstanceId, status, Date.now());
    await this.taskFacade.updateTaskInstanceStatus(taskInstanceId, status);
    if (status === 'health_check_failure' || status === 'exit(1)') {
      logger.info(`Task instance ${taskInstanceId} has abnormal status ${status}.`);
      const instance = await this.taskFacade.getTaskInstance(taskInstanceId);
      const task = await this.taskFacade.getTask(instance.taskId, instance.taskVersion);
      await this.createIssue(task, instance, status);
    }
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

  async handleTaskInstancePid(taskInstanceId: string, pid: number): Promise<void> {
    logger.info(`Handle task instance ${taskInstanceId} pid ${pid}.`);
    await this.taskFacade.setTaskInstancPid(taskInstanceId, pid);
  }

  async handleAgentStatus(agentId: string, name: string): Promise<void> {
    logger.info(`Handle agent ${agentId} ${name} refresh status.`);
    const agent = this.agentList.find((a) => a.identifier === agentId);
    if (agent) {
      agent.lastPingAt = Date.now();
      agent.status = 'online'; // in case it was changed to offline, now make it online.
      agent.name = name; // in case name changed.
    } else {
      logger.info(`Add new agent ${agentId} ${name} to agent list.`);
      this.agentList.push({
        identifier: agentId,
        status: 'online',
        name: name,
        lastPingAt: Date.now(),
      });
    }
  }

  async launchTask(taskId: string, taskAgentIds: string[], arguments_?: string[]): Promise<LaunchTaskInstanceResult[]> {
    logger.info(`Launch task ${taskId} on agents ${taskAgentIds.join(', ')} with arguments ${arguments_?.join(', ')}.`);
    let task = await this.taskFacade.getTask(taskId);
    task = arguments_ !== undefined ? this.addAdditionalArguments(task, arguments_) : task;
    return await this.internalLaunchTask(task, taskAgentIds);
  }

  private addAdditionalArguments(task: Task, arguments_: string[]): Task {
    return {
      ...task,
      arguments: task.arguments ? task.arguments.concat(arguments_) : arguments_,
    };
  }

  async terminateTaskInstance(instanceId: string): Promise<void> {
    logger.info(`Terminate task instance ${instanceId}.`);
    const instance = await this.taskFacade.getTaskInstance(instanceId);

    if (TERMINATION_PERMITTED_STATUSES.includes(instance.status) && typeof instance.pid === 'number') {
      await this.agentController.terminate(instance.agentId, instanceId, instance.pid);
      const message = `Successfully initiated termination on task instance ${instanceId} pid ${instance.pid}.`;
      logger.info(message);
      await this.addInstanceStatusAndEvent(instanceId, 'termination_initiated', 'success', message);
    } else {
      let message = `Failed to terminate task instance ${instanceId}.`;
      if (instance.status !== 'running') {
        message = `Failed to terminate task instance ${instanceId} because its current status is ${instance.status} not "running".`;
      } else if (instance.pid === undefined) {
        message = `Failed to terminate task instance ${instanceId} because of unknown pid.`;
      }
      logger.warn(message);
      throw EnhancedError.create(Errors.INVALID_REQUEST, 400, message);
    }
  }

  async listTaskAgents(): Promise<TaskAgent[]> {
    logger.info(`List task agents.`);
    return this.agentList.map((agent) => this.convertInternalAgentToAgent(agent));
  }

  async terminateTaskAgent(agentId: string): Promise<void> {
    logger.info(`Terminate task agent ${agentId}.`);
    const agent = this.agentList.find((agent) => agent.identifier === agentId);
    if (agent?.status === 'online') {
      await this.agentController.terminateAgent(agentId);
      agent.status = 'offline';
    } else {
      logger.info(`Task agent ${agentId} doesn't exist or is offline.`);
    }
  }

  /**
   * launch job if its derived next launch fall between window [number, number).
   * @param window
   */
  async launchJobs(window: [number, number]): Promise<LaunchTaskInstanceResult[]> {
    logger.debug(`Launch jobs fall between ${new Date(window[0]).toISOString()} and ${new Date(window[1]).toISOString()}.`);
    const tasks = await this.taskFacade.listLatestTasks();
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
      const dynamics = await this.taskFacade.getTaskDynamics(jobsToLaunch[i].taskId);
      if (dynamics.active) {
        const temp = await this.internalLaunchTask(jobsToLaunch[i], dynamics.targetAgentIds);
        results = results.concat(temp);
      }
    }
    return results;
  }

  private async internalLaunchTask(task: Task, targetAgentIds: string[]): Promise<LaunchTaskInstanceResult[]> {
    logger.info(`Launch task ${task.taskId} ${task.version} ${task.name}.`);
    const results: LaunchTaskInstanceResult[] = [];
    const translatedTask = await this.variableManager.replace(task);
    for (let i = 0; i < targetAgentIds.length; i++) {
      const agentId = targetAgentIds[i];
      logger.info(`Prepare task ${task.taskId} ${task.version} for agent ${agentId}.`);
      const taskInstanceId = await this.taskFacade.createTaskInstance(translatedTask.taskId, translatedTask.version, agentId);
      this.taskStatusWatcher.watch(taskInstanceId, 'init', Date.now());
      const agent = this.agentList.find((agent) => agent.identifier === agentId);

      let status: 'initiated' | 'initiation_failed';
      if (agent?.status === 'online') {
        logger.info(`Agent ${agentId} is online, sending launch request to it.`);
        await this.agentController.launch(agentId, {
          taskId: translatedTask.taskId,
          version: translatedTask.version,
          taskInstanceId: taskInstanceId,
          cmd: translatedTask.cmd,
          cwd: translatedTask.cwd,
          arguments: translatedTask.arguments,
          env: translatedTask.env,
          stdout: translatedTask.stdout,
          stderr: translatedTask.stderr,
          healthCheck: translatedTask.type === 'service' ? translatedTask.healthCheck : undefined,
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
    await this.agentController.requestAgentStatus();
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
    await this.taskFacade.updateTaskInstanceStatus(instanceId, status);
    await this.taskFacade.addTaskEvent({
      instanceId: instanceId,
      source: 'task-service',
      timestamp: Date.now(),
      level: level,
      format: 'string',
      payload: message,
    });
  }
}

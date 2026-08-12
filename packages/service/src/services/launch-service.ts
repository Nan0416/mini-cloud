import {
  ConflictError,
  InvalidRequestError,
  Job,
  LaunchInstruction,
  LaunchResult,
  LoggerFactory,
  ReplacementVariables,
  TERMINATION_PERMITTED_STATUSES,
  Task,
  substituteLaunchFields,
} from '@mini-cloud/shared';
import { AgentCommander } from '../facades/agent-commander';
import { InstanceService } from './instance-service';
import { TaskService } from './task-service';

const logger = LoggerFactory.getLogger('LaunchService');

export interface LaunchServiceProps {
  readonly taskService: TaskService;
  readonly instanceService: InstanceService;
  readonly agentCommander: AgentCommander;
}

/** Turns a task definition into running processes on agents, and stops them again. */
export class LaunchService {
  private readonly taskService: TaskService;
  private readonly instanceService: InstanceService;
  private readonly agentCommander: AgentCommander;

  constructor(props: LaunchServiceProps) {
    this.taskService = props.taskService;
    this.instanceService = props.instanceService;
    this.agentCommander = props.agentCommander;
  }

  /** Manual launch. Falls back to the task's configured agents when none are given. */
  async launchTask(taskId: string, targetAgentIds?: ReadonlyArray<string>, extraArguments?: ReadonlyArray<string>): Promise<ReadonlyArray<LaunchResult>> {
    const task = await this.taskService.getTask(taskId);
    const agentIds = targetAgentIds ?? (await this.taskService.getDynamics(taskId)).targetAgentIds;
    if (agentIds.length === 0) {
      throw new InvalidRequestError(`Task ${taskId} has no target agents. Pass targetAgentIds or configure them on the task first.`);
    }
    const variables = await this.taskService.listVariables();
    return this.dispatch(task, agentIds, variables, extraArguments);
  }

  /** Scheduled launch. Takes variables from the caller so a tick reads them once. */
  async launchScheduledJob(job: Job, targetAgentIds: ReadonlyArray<string>, variables: ReplacementVariables): Promise<ReadonlyArray<LaunchResult>> {
    return this.dispatch(job, targetAgentIds, variables);
  }

  async terminateInstance(instanceId: string): Promise<void> {
    const instance = await this.instanceService.getInstance(instanceId);

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
      await this.instanceService.recordStatusWithEvent(
        instanceId,
        'termination_initiated',
        'success',
        `Sent terminate command for pid ${instance.pid} to agent ${instance.agentId}.`,
      );
      return;
    }

    const message = `Agent ${instance.agentId} is not connected, so the terminate command could not be delivered.`;
    await this.instanceService.recordStatusWithEvent(instanceId, 'termination_failed', 'error', message);
    throw new ConflictError(message);
  }

  private async dispatch(
    task: Task,
    agentIds: ReadonlyArray<string>,
    variables: ReplacementVariables,
    extraArguments?: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<LaunchResult>> {
    // Substitution and argument assembly happen once, not per agent: every agent
    // must run byte-identical arguments for the instances to be comparable.
    const resolved = substituteLaunchFields(task, variables);
    const args = extraArguments === undefined ? resolved.arguments : [...(resolved.arguments ?? []), ...extraArguments];

    logger.info(`Launching task ${task.taskId} v${task.version} ("${task.name}") on ${agentIds.length} agent(s).`);

    const results: LaunchResult[] = [];
    for (const agentId of agentIds) {
      results.push(await this.dispatchOne(task, resolved, args, agentId));
    }
    return results;
  }

  private async dispatchOne(task: Task, resolved: Task, args: ReadonlyArray<string> | undefined, agentId: string): Promise<LaunchResult> {
    // The instance row is written before the command is sent, so a launch that never
    // reaches its agent still leaves a record explaining why.
    const instanceId = await this.instanceService.createInstance(task.taskId, task.version, agentId);

    const instruction: LaunchInstruction = {
      taskId: task.taskId,
      version: task.version,
      instanceId,
      cmd: resolved.cmd,
      cwd: resolved.cwd,
      arguments: args,
      env: resolved.env,
      stdout: resolved.stdout,
      stderr: resolved.stderr,
      healthCheck: resolved.type === 'service' ? resolved.healthCheck : undefined,
    };

    const delivered = this.agentCommander.launchInstance(agentId, instruction);
    if (delivered > 0) {
      const message = `Dispatched launch of task ${task.taskId} v${task.version} to agent ${agentId}.`;
      await this.instanceService.recordStatusWithEvent(instanceId, 'initiated', 'success', message);
      return { taskId: task.taskId, taskVersion: task.version, instanceId, agentId, status: 'initiated' };
    }

    const message = `Agent ${agentId} is not connected, so the launch command could not be delivered.`;
    logger.warn(message);
    await this.instanceService.recordStatusWithEvent(instanceId, 'initiation_failed', 'error', message);
    return { taskId: task.taskId, taskVersion: task.version, instanceId, agentId, status: 'initiation_failed', message };
  }
}

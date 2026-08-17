import { LaunchInstruction, LaunchResult, LoggerFactory, ReplacementVariables, Task, substituteLaunchFields } from '@mini-cloud/shared';
import { TaskEventDao } from '../data/task-event-dao';
import { TaskInstanceDao } from '../data/task-instance-dao';
import { generateEventId, generateInstanceId } from '../utils/ids';
import { AgentCommander } from './agent-commander';

const logger = LoggerFactory.getLogger('TaskDispatcher');

/**
 * One launch of one task onto a set of agents.
 *
 * Not exported from the package: dispatching is reached through `TaskService`, which
 * is what resolves the task and its agents in the first place.
 */
export interface DispatchTaskRequest {
  readonly task: Task;
  readonly agentIds: ReadonlyArray<string>;
  readonly variables: ReplacementVariables;
  /** Appended to the task's own arguments for this launch only. */
  readonly extraArguments?: ReadonlyArray<string>;
}

export interface DispatchTaskResponse {
  readonly results: ReadonlyArray<LaunchResult>;
}

export interface TaskDispatcherProps {
  readonly taskInstanceDao: TaskInstanceDao;
  readonly taskEventDao: TaskEventDao;
  readonly agentCommander: AgentCommander;
}

/**
 * Turns a resolved task into running processes on agents.
 *
 * Owns the whole per-agent launch step — creating the instance row, sending the
 * command and recording what came back — because those three are one unit: the row
 * exists so that a command which never arrives still leaves a record explaining why.
 * It writes those records straight to the DAOs rather than calling back into
 * `TaskService`, which would make the two mutually dependent.
 *
 * Deciding *whether* to launch, and on which agents, stays in `TaskService`. This
 * only carries out a decision already made.
 */
export class TaskDispatcher {
  private readonly taskInstanceDao: TaskInstanceDao;
  private readonly taskEventDao: TaskEventDao;
  private readonly agentCommander: AgentCommander;

  constructor(props: TaskDispatcherProps) {
    this.taskInstanceDao = props.taskInstanceDao;
    this.taskEventDao = props.taskEventDao;
    this.agentCommander = props.agentCommander;
  }

  async dispatch(request: DispatchTaskRequest): Promise<DispatchTaskResponse> {
    const { task, agentIds, variables, extraArguments } = request;

    // Substitution and argument assembly happen once, not per agent: every agent
    // must run byte-identical arguments for the instances to be comparable.
    const resolved = substituteLaunchFields(task, variables);
    const args = extraArguments === undefined ? resolved.arguments : [...(resolved.arguments ?? []), ...extraArguments];

    logger.info(`Launching task ${task.taskId} v${task.version} ("${task.name}") on ${agentIds.length} agent(s).`);

    const results: LaunchResult[] = [];
    for (const agentId of agentIds) {
      results.push(await this.dispatchOne(task, resolved, args, agentId));
    }
    return { results };
  }

  private async dispatchOne(task: Task, resolved: Task, args: ReadonlyArray<string> | undefined, agentId: string): Promise<LaunchResult> {
    // The instance row is written before the command is sent, so a launch that never
    // reaches its agent still leaves a record explaining why.
    const instanceId = await this.createInstance(task, agentId);

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
      await this.recordOutcome(instanceId, 'initiated', 'success', message);
      return { taskId: task.taskId, taskVersion: task.version, instanceId, agentId, status: 'initiated' };
    }

    const message = `Agent ${agentId} is not connected, so the launch command could not be delivered.`;
    logger.warn(message);
    await this.recordOutcome(instanceId, 'initiation_failed', 'error', message);
    return { taskId: task.taskId, taskVersion: task.version, instanceId, agentId, status: 'initiation_failed', message };
  }

  private async createInstance(task: Task, agentId: string): Promise<string> {
    const instanceId = generateInstanceId();
    await this.taskInstanceDao.createInstance({ instanceId, taskId: task.taskId, taskVersion: task.version, agentId, status: 'init' });
    logger.info(`Created instance ${instanceId} for task ${task.taskId} v${task.version} on agent ${agentId}.`);
    return instanceId;
  }

  /**
   * Records how the dispatch went.
   *
   * Skips the existence guard that `TaskService.recordStatus` applies, because the
   * row was created a few lines earlier by this same call — the guard is there for
   * instance ids that arrived from outside.
   */
  private async recordOutcome(instanceId: string, status: 'initiated' | 'initiation_failed', level: 'success' | 'error', message: string): Promise<void> {
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
}

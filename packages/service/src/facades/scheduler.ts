import { LoggerFactory, TaskInstanceStatus } from '@mini-cloud/shared';
import { AgentDao } from '../data/agent-dao';
import { TaskDao } from '../data/task-dao';
import { TaskEventDao } from '../data/task-event-dao';
import { TaskInstanceDao } from '../data/task-instance-dao';
import { VariableDao } from '../data/variable-dao';
import { generateEventId } from '../utils/ids';
import { shouldLaunchInWindow } from '../utils/job-window';
import { AgentCommander } from './agent-commander';
import { TaskDispatcher } from './task-dispatcher';

const logger = LoggerFactory.getLogger('Scheduler');

export interface SchedulerConfig {
  /** How often to look for jobs due to launch. Must be <= the shortest job interval. */
  readonly jobTickMs: number;
  /** How often to probe agents and sweep stuck instances. */
  readonly maintenanceTickMs: number;
  /** Silence after which an agent is considered offline. */
  readonly agentOfflineAfterMs: number;
  /** How long an instance may sit at `initiated` before the agent is presumed unreachable. */
  readonly launchTimeoutMs: number;
  /** How long an instance may sit at `launched` before the process is presumed stillborn. */
  readonly startTimeoutMs: number;
  readonly retentionDays: number;
  readonly retentionTickMs: number;
}

export interface SchedulerProps {
  readonly taskDao: TaskDao;
  readonly taskInstanceDao: TaskInstanceDao;
  readonly taskEventDao: TaskEventDao;
  readonly agentDao: AgentDao;
  readonly variableDao: VariableDao;
  readonly agentCommander: AgentCommander;
  readonly taskDispatcher: TaskDispatcher;
  readonly config: SchedulerConfig;
}

/**
 * The service's background loops: launching due jobs, probing agent liveness,
 * failing instances that got stuck mid-launch, and pruning old history.
 *
 * Reads and writes through the DAOs rather than through `TaskService`. Nothing here
 * answers a request, so there is no contract to honour — a tick decides what to do
 * from rows it reads itself, and the one thing it does not do itself, dispatching a
 * launch, goes through `TaskDispatcher` like every other launch.
 */
export class Scheduler {
  private readonly props: SchedulerProps;
  private jobTimer?: NodeJS.Timeout;
  private maintenanceTimer?: NodeJS.Timeout;
  private retentionTimer?: NodeJS.Timeout;

  /** Start of the next launch window. Undefined until the first tick establishes it. */
  private windowStart?: number;

  // A slow tick must not overlap the next one: two concurrent job ticks sharing a
  // window would launch the same job twice.
  private jobTickRunning = false;
  private maintenanceTickRunning = false;

  constructor(props: SchedulerProps) {
    this.props = props;
  }

  start(): void {
    const { config } = this.props;
    logger.info(`Starting scheduler: job tick ${config.jobTickMs}ms, maintenance tick ${config.maintenanceTickMs}ms, retention ${config.retentionDays} days.`);

    this.windowStart = Date.now();
    this.jobTimer = setInterval(() => void this.runJobTick(), config.jobTickMs);
    this.maintenanceTimer = setInterval(() => void this.runMaintenanceTick(), config.maintenanceTickMs);
    this.retentionTimer = setInterval(() => void this.runRetentionTick(), config.retentionTickMs);
  }

  stop(): void {
    logger.info('Stopping scheduler.');
    for (const timer of [this.jobTimer, this.maintenanceTimer, this.retentionTimer]) {
      if (timer !== undefined) {
        clearInterval(timer);
      }
    }
    this.jobTimer = undefined;
    this.maintenanceTimer = undefined;
    this.retentionTimer = undefined;
  }

  /**
   * Launches every active job whose next occurrence falls in `[windowStart, now)`.
   *
   * Windows are contiguous and never overlap, so a job fires exactly once per
   * occurrence even though the tick interval and the job interval are unrelated.
   */
  async runJobTick(): Promise<void> {
    if (this.jobTickRunning) {
      logger.warn('Skipping job tick: the previous one is still running.');
      return;
    }
    this.jobTickRunning = true;

    const from = this.windowStart ?? Date.now();
    const to = Date.now();
    try {
      const { scheduledJobs } = await this.props.taskDao.listScheduledJobs({});
      const due = scheduledJobs.filter((entry) => shouldLaunchInWindow(entry.job, { from, to }));
      if (due.length > 0) {
        // Read the variable set once per tick rather than once per job.
        const { variables } = await this.props.variableDao.listVariables({});
        for (const entry of due) {
          logger.info(`Job ${entry.job.taskId} ("${entry.job.name}") is due; launching on ${entry.targetAgentIds.length} agent(s).`);
          await this.props.taskDispatcher.dispatch({ task: entry.job, agentIds: entry.targetAgentIds, variables });
        }
      }
      // Only advance after a successful tick, so a transient database error retries
      // the same window instead of silently skipping the launches inside it.
      this.windowStart = to;
    } catch (err) {
      logger.error(`Job tick for window [${new Date(from).toISOString()}, ${new Date(to).toISOString()}) failed; the window will be retried.`, err);
    } finally {
      this.jobTickRunning = false;
    }
  }

  async runMaintenanceTick(): Promise<void> {
    if (this.maintenanceTickRunning) {
      return;
    }
    this.maintenanceTickRunning = true;
    try {
      this.props.agentCommander.requestHeartbeat();
      await this.expireAgents();
      await this.failStuckInstances();
    } catch (err) {
      logger.error('Maintenance tick failed.', err);
    } finally {
      this.maintenanceTickRunning = false;
    }
  }

  async runRetentionTick(): Promise<void> {
    const before = Date.now() - this.props.config.retentionDays * 24 * 3600_000;
    try {
      const { deletedCount } = await this.props.taskInstanceDao.deleteInstancesUpdatedBefore({ before });
      if (deletedCount > 0) {
        logger.info(`Retention removed ${deletedCount} instance(s) last updated before ${new Date(before).toISOString()}.`);
      }
    } catch (err) {
      logger.error('Retention tick failed.', err);
    }
  }

  /** Marks agents that stopped heartbeating as offline. */
  private async expireAgents(): Promise<void> {
    const { agents: expired } = await this.props.agentDao.expireAgents({ before: Date.now() - this.props.config.agentOfflineAfterMs });
    for (const agent of expired) {
      logger.warn(`Agent ${agent.agentId} ("${agent.name}") stopped heartbeating; marked offline.`);
    }
  }

  /**
   * Instances that stopped progressing get a terminal-ish status and an event saying
   * where they stalled, so a launch that vanished is visible instead of sitting at
   * `initiated` forever.
   */
  private async failStuckInstances(): Promise<void> {
    const now = Date.now();
    const { launchTimeoutMs, startTimeoutMs } = this.props.config;

    const { instances: neverAcknowledged } = await this.props.taskInstanceDao.listStaleInstances({ status: 'initiated', olderThan: now - launchTimeoutMs });
    for (const instance of neverAcknowledged) {
      await this.failInstance(instance.instanceId, 'launching_timeout', `Agent ${instance.agentId} did not acknowledge the launch within ${launchTimeoutMs}ms.`);
    }

    const { instances: neverStarted } = await this.props.taskInstanceDao.listStaleInstances({ status: 'launched', olderThan: now - startTimeoutMs });
    for (const instance of neverStarted) {
      const message = `The process was spawned but never reported a pid within ${startTimeoutMs}ms. Check the task's cwd, command and stderr.`;
      await this.failInstance(instance.instanceId, 'start_timeout', message);
    }
  }

  /**
   * Writes the timeout status and the event explaining it.
   *
   * An instance that disappeared between the listing and the write is not an error
   * here: a sweep must not abort partway because retention pruned a row underneath it.
   */
  private async failInstance(instanceId: string, status: TaskInstanceStatus, message: string): Promise<void> {
    await this.props.taskInstanceDao.updateStatus({ instanceId, status });
    await this.props.taskEventDao.createEvent({
      eventId: generateEventId(),
      instanceId,
      source: 'service',
      level: 'error',
      payload: message,
      timestamp: Date.now(),
    });
  }
}

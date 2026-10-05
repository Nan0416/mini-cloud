import {
  AgentCommand,
  Dashboard,
  Monitor,
  MonitorStateChange,
  Notifier,
  Job,
  LaunchInstruction,
  ReplacementVariables,
  Service,
  TASK_INSTANCE_STATUS_RANK,
  Task,
  TaskAgent,
  TaskDynamics,
  TaskEvent,
  TaskInstance,
  TaskInstanceStatus,
} from '@mini-cloud/shared';
import {
  CreateDashboardInput,
  CreateDashboardOutput,
  DashboardDao,
  DeleteDashboardInput,
  DeleteDashboardOutput,
  GetDashboardInput,
  GetDashboardOutput,
  ListDashboardsOutput,
  UpdateDashboardInput,
  UpdateDashboardOutput,
} from '../../src/data/dashboard-dao';
import {
  AgentDao,
  ExpireAgentsInput,
  ExpireAgentsOutput,
  GetAgentInput,
  GetAgentOutput,
  ListAgentsOutput,
  SetStatusInput,
  SetStatusOutput,
  RecordHeartbeatInput,
  RecordHeartbeatOutput,
} from '../../src/data/agent-dao';
import {
  CreateTaskVersionInput,
  CreateTaskVersionOutput,
  DeleteTaskInput,
  DeleteTaskOutput,
  GetLatestTaskInput,
  GetLatestTaskOutput,
  GetLatestVersionNumberInput,
  GetLatestVersionNumberOutput,
  GetTaskVersionInput,
  GetTaskVersionOutput,
  ListHealthChecksInput,
  ListHealthChecksOutput,
  ListLatestTasksOutput,
  ListScheduledJobsOutput,
  ScheduledJob,
  TaskDao,
} from '../../src/data/task-dao';
import {
  GetDynamicsInput,
  GetDynamicsOutput,
  SetActiveInput,
  SetActiveOutput,
  SetTargetAgentsInput,
  SetTargetAgentsOutput,
  TaskDynamicsDao,
} from '../../src/data/task-dynamics-dao';
import { CreateEventInput, CreateEventOutput, ListEventsInput, ListEventsOutput, TaskEventDao } from '../../src/data/task-event-dao';
import {
  CreateInstanceInput,
  CreateInstanceOutput,
  DeleteInstancesUpdatedBeforeInput,
  DeleteInstancesUpdatedBeforeOutput,
  GetInstanceInput,
  GetInstanceOutput,
  ListInstancesInput,
  ListInstancesOutput,
  ListStaleInstancesInput,
  ListStaleInstancesOutput,
  SetPidInput,
  SetPidOutput,
  TaskInstanceDao,
  UpdateStatusInput,
  UpdateStatusOutput,
} from '../../src/data/task-instance-dao';
import {
  ChangeStateInput,
  ChangeStateOutput,
  CreateMonitorInput,
  CreateMonitorOutput,
  DeleteMonitorInput,
  DeleteMonitorOutput,
  GetMonitorInput,
  GetMonitorOutput,
  ListMonitorsOutput,
  ListStateChangesInput,
  ListStateChangesOutput,
  MarkEvaluatedInput,
  MarkEvaluatedOutput,
  MonitorDao,
  UpdateMonitorInput,
  UpdateMonitorOutput,
} from '../../src/data/monitor-dao';
import {
  CreateNotifierInput,
  CreateNotifierOutput,
  DeleteNotifierInput,
  DeleteNotifierOutput,
  GetNotifierInput,
  GetNotifierOutput,
  ListDeliveryTargetsInput,
  ListDeliveryTargetsOutput,
  ListNotifiersOutput,
  NotifierCredentials,
  NotifierDao,
  UpdateNotifierInput,
  UpdateNotifierOutput,
} from '../../src/data/notifier-dao';
import { ListVariablesOutput, ReplaceVariablesInput, ReplaceVariablesOutput, VariableDao } from '../../src/data/variable-dao';
import { AgentCommander } from '../../src/facades/agent-commander';

/**
 * In-memory DAOs, for testing the layers above the database.
 *
 * These are fakes rather than mocks on purpose. `TaskService` and `Scheduler` are
 * almost entirely sequencing — read a row, decide, write another — so a test that
 * asserts on call arguments ends up restating the implementation line by line, and
 * passes just as happily when the sequence is wrong. Against a fake that actually
 * stores what it is given, the same test says what the caller would observe: launch a
 * task and the instance exists; terminate it twice and the second attempt is refused.
 *
 * They implement the real semantics wherever a caller depends on them — notably the
 * rank guard in `updateStatus`, which is the rule the whole status pipeline rests on.
 * They deliberately do not model SQL; that is `tests/data-integration/`'s job.
 */

const HOUR = 3600_000;
/** A fixed "now" so tests can reason about windows without touching the clock. */
export const NOW = Date.UTC(2026, 5, 1, 12, 0, 0);

/**
 * Returns `Job` and `Service` rather than the `Task` union: `ScheduledJob.job` is a
 * `Job`, so a fixture typed as the union cannot be used where the scheduler needs one.
 */
export function aJob(overrides: Partial<Job> = {}): Job {
  return {
    taskId: 't1',
    version: 1,
    createdAt: NOW - HOUR,
    lastUpdatedAt: NOW - HOUR,
    name: 'nightly backup',
    cmd: 'backup.sh',
    cwd: '/srv',
    ...overrides,
    type: 'job',
  };
}

export function aService(overrides: Partial<Service> = {}): Service {
  return {
    taskId: 's1',
    version: 1,
    createdAt: NOW - HOUR,
    lastUpdatedAt: NOW - HOUR,
    name: 'api',
    cmd: 'server.js',
    cwd: '/srv',
    ...overrides,
    type: 'service',
  };
}

export class FakeTaskDao implements TaskDao {
  /** `${taskId}@${version}` → task. */
  private readonly versions = new Map<string, Task>();
  scheduledJobs: ReadonlyArray<ScheduledJob> = [];
  /** Set to make the next read throw, for exercising a caller's error path. */
  failNext?: Error;

  /** Seeds a task at a given version without going through `createTaskVersion`. */
  seed(...tasks: ReadonlyArray<Task>): this {
    for (const task of tasks) {
      this.versions.set(`${task.taskId}@${task.version}`, task);
    }
    return this;
  }

  async createTaskVersion(input: CreateTaskVersionInput): Promise<CreateTaskVersionOutput> {
    const base = {
      taskId: input.taskId,
      version: input.version,
      createdAt: this.versions.has(`${input.taskId}@1`) ? (this.versions.get(`${input.taskId}@1`) as Task).createdAt : NOW,
      lastUpdatedAt: NOW,
      name: input.name,
      description: input.description,
      cmd: input.cmd,
      cwd: input.cwd,
      arguments: input.arguments,
      env: input.env,
      stdout: input.stdout,
      stderr: input.stderr,
    };
    const task =
      input.type === 'job'
        ? ({ ...base, type: 'job', duration: input.durationMs, firstLaunchAt: input.firstLaunchAt } as Task)
        : ({ ...base, type: 'service', healthCheck: input.healthCheck } as Task);
    this.versions.set(`${input.taskId}@${input.version}`, task);
    return {};
  }

  async getTaskVersion(input: GetTaskVersionInput): Promise<GetTaskVersionOutput> {
    return { task: this.versions.get(`${input.taskId}@${input.version}`) ?? null };
  }

  async getLatestTask(input: GetLatestTaskInput): Promise<GetLatestTaskOutput> {
    this.throwIfArmed();
    const all = this.versionsOf(input.taskId);
    return { task: all.length === 0 ? null : (all[all.length - 1] as Task) };
  }

  async getLatestVersionNumber(input: GetLatestVersionNumberInput): Promise<GetLatestVersionNumberOutput> {
    this.throwIfArmed();
    const all = this.versionsOf(input.taskId);
    return { version: all.length === 0 ? null : (all[all.length - 1] as Task).version };
  }

  async listLatestTasks(): Promise<ListLatestTasksOutput> {
    const heads = new Map<string, Task>();
    for (const task of this.versions.values()) {
      const head = heads.get(task.taskId);
      if (head === undefined || task.version > head.version) {
        heads.set(task.taskId, task);
      }
    }
    return { tasks: [...heads.values()].sort((left, right) => right.createdAt - left.createdAt) };
  }

  async deleteTask(input: DeleteTaskInput): Promise<DeleteTaskOutput> {
    for (const key of [...this.versions.keys()]) {
      if (key.startsWith(`${input.taskId}@`)) {
        this.versions.delete(key);
      }
    }
    return {};
  }

  async listHealthChecks(input: ListHealthChecksInput): Promise<ListHealthChecksOutput> {
    const healthChecks = [];
    for (const identifier of input.identifiers) {
      const task = this.versions.get(`${identifier.taskId}@${identifier.version}`);
      if (task?.type === 'service' && task.healthCheck !== undefined) {
        healthChecks.push({ taskId: task.taskId, version: task.version, healthCheck: task.healthCheck });
      }
    }
    return { healthChecks };
  }

  async listScheduledJobs(): Promise<ListScheduledJobsOutput> {
    this.throwIfArmed();
    return { scheduledJobs: this.scheduledJobs };
  }

  private versionsOf(taskId: string): ReadonlyArray<Task> {
    return [...this.versions.values()].filter((task) => task.taskId === taskId).sort((left, right) => left.version - right.version);
  }

  private throwIfArmed(): void {
    if (this.failNext !== undefined) {
      const err = this.failNext;
      this.failNext = undefined;
      throw err;
    }
  }
}

export class FakeTaskDynamicsDao implements TaskDynamicsDao {
  private readonly rows = new Map<string, TaskDynamics>();

  seed(...rows: ReadonlyArray<TaskDynamics>): this {
    for (const row of rows) {
      this.rows.set(row.taskId, row);
    }
    return this;
  }

  async getDynamics(input: GetDynamicsInput): Promise<GetDynamicsOutput> {
    return { dynamics: this.rows.get(input.taskId) ?? null };
  }

  async setActive(input: SetActiveInput): Promise<SetActiveOutput> {
    const existing = this.rows.get(input.taskId) ?? { taskId: input.taskId, active: false, targetAgentIds: [] };
    const dynamics = { ...existing, active: input.active };
    this.rows.set(input.taskId, dynamics);
    return { dynamics };
  }

  async setTargetAgents(input: SetTargetAgentsInput): Promise<SetTargetAgentsOutput> {
    const existing = this.rows.get(input.taskId) ?? { taskId: input.taskId, active: false, targetAgentIds: [] };
    const dynamics = { ...existing, targetAgentIds: [...input.targetAgentIds] };
    this.rows.set(input.taskId, dynamics);
    return { dynamics };
  }
}

export class FakeTaskInstanceDao implements TaskInstanceDao {
  readonly instances = new Map<string, TaskInstance>();
  /** Status writes that the rank guard rejected, for asserting a stale report lost. */
  readonly rejected: ReadonlyArray<UpdateStatusInput> = [];
  private clock = NOW;

  seed(...instances: ReadonlyArray<TaskInstance>): this {
    for (const instance of instances) {
      this.instances.set(instance.instanceId, instance);
    }
    return this;
  }

  /** Moves the fake's clock, so `updated_at` ordering can be arranged deliberately. */
  setNow(now: number): this {
    this.clock = now;
    return this;
  }

  async createInstance(input: CreateInstanceInput): Promise<CreateInstanceOutput> {
    this.instances.set(input.instanceId, {
      instanceId: input.instanceId,
      taskId: input.taskId,
      taskVersion: input.taskVersion,
      agentId: input.agentId,
      status: input.status,
      createdAt: this.clock,
      lastUpdatedAt: this.clock,
    });
    return {};
  }

  async getInstance(input: GetInstanceInput): Promise<GetInstanceOutput> {
    return { instance: this.instances.get(input.instanceId) ?? null };
  }

  async listInstances(input: ListInstancesInput): Promise<ListInstancesOutput> {
    const matches = [...this.instances.values()].filter(
      (instance) =>
        (input.taskId === undefined || instance.taskId === input.taskId) &&
        (input.version === undefined || instance.taskVersion === input.version) &&
        (input.agentId === undefined || instance.agentId === input.agentId) &&
        (input.status === undefined || instance.status === input.status) &&
        (input.from === undefined || instance.lastUpdatedAt >= input.from) &&
        (input.to === undefined || instance.lastUpdatedAt < input.to),
    );
    return { instances: matches.sort((left, right) => right.lastUpdatedAt - left.lastUpdatedAt).slice(0, input.limit ?? 200) };
  }

  async updateStatus(input: UpdateStatusInput): Promise<UpdateStatusOutput> {
    const existing = this.instances.get(input.instanceId);
    if (existing === undefined) {
      return { found: false, applied: false };
    }
    // The same guard the SQL applies: equal ranks pass, so running and
    // health_check_failure can flip, while a stale report cannot move it backwards.
    if (TASK_INSTANCE_STATUS_RANK[existing.status] > TASK_INSTANCE_STATUS_RANK[input.status]) {
      (this.rejected as UpdateStatusInput[]).push(input);
      return { found: true, applied: false, currentStatus: existing.status };
    }
    this.instances.set(input.instanceId, { ...existing, status: input.status, lastUpdatedAt: this.clock });
    return { found: true, applied: true, currentStatus: input.status };
  }

  async setPid(input: SetPidInput): Promise<SetPidOutput> {
    const existing = this.instances.get(input.instanceId);
    if (existing === undefined) {
      return { found: false };
    }
    this.instances.set(input.instanceId, { ...existing, pid: input.pid, lastUpdatedAt: this.clock });
    return { found: true };
  }

  async listStaleInstances(input: ListStaleInstancesInput): Promise<ListStaleInstancesOutput> {
    return { instances: [...this.instances.values()].filter((instance) => instance.status === input.status && instance.lastUpdatedAt < input.olderThan) };
  }

  async deleteInstancesUpdatedBefore(input: DeleteInstancesUpdatedBeforeInput): Promise<DeleteInstancesUpdatedBeforeOutput> {
    let deletedCount = 0;
    for (const [instanceId, instance] of [...this.instances]) {
      if (instance.lastUpdatedAt < input.before) {
        this.instances.delete(instanceId);
        deletedCount += 1;
      }
    }
    return { deletedCount };
  }

  /** The status an instance ended up at, for reading an assertion out of a scenario. */
  statusOf(instanceId: string): TaskInstanceStatus | undefined {
    return this.instances.get(instanceId)?.status;
  }
}

export class FakeTaskEventDao implements TaskEventDao {
  readonly events: TaskEvent[] = [];
  /** The limit the last listing was given — the only way to see an applied default. */
  lastListLimit?: number;

  async createEvent(input: CreateEventInput): Promise<CreateEventOutput> {
    this.events.push({ ...input, timestamp: input.timestamp });
    return {};
  }

  async listEvents(input: ListEventsInput): Promise<ListEventsOutput> {
    this.lastListLimit = input.limit;
    return { events: this.events.filter((event) => event.instanceId === input.instanceId).slice(0, input.limit) };
  }

  /** Just the payloads for one instance, which is what most assertions want. */
  payloadsFor(instanceId: string): ReadonlyArray<unknown> {
    return this.events.filter((event) => event.instanceId === instanceId).map((event) => event.payload);
  }
}

export class FakeVariableDao implements VariableDao {
  variables: ReplacementVariables = {};

  seed(variables: ReplacementVariables): this {
    this.variables = variables;
    return this;
  }

  async listVariables(): Promise<ListVariablesOutput> {
    return { variables: this.variables };
  }

  async replaceVariables(input: ReplaceVariablesInput): Promise<ReplaceVariablesOutput> {
    this.variables = { ...input.variables };
    return { variables: this.variables };
  }
}

export class FakeAgentDao implements AgentDao {
  readonly agents = new Map<string, TaskAgent>();

  seed(...agents: ReadonlyArray<TaskAgent>): this {
    for (const agent of agents) {
      this.agents.set(agent.agentId, agent);
    }
    return this;
  }

  async recordHeartbeat(input: RecordHeartbeatInput): Promise<RecordHeartbeatOutput> {
    const existing = this.agents.get(input.agentId);
    const agent: TaskAgent = {
      agentId: input.agentId,
      name: input.name,
      status: 'online',
      lastSeenAt: NOW,
      registeredAt: existing?.registeredAt ?? NOW,
    };
    this.agents.set(input.agentId, agent);
    return { agent };
  }

  async getAgent(input: GetAgentInput): Promise<GetAgentOutput> {
    return { agent: this.agents.get(input.agentId) ?? null };
  }

  async listAgents(): Promise<ListAgentsOutput> {
    return { agents: [...this.agents.values()].sort((left, right) => left.name.localeCompare(right.name)) };
  }

  async setStatus(input: SetStatusInput): Promise<SetStatusOutput> {
    const existing = this.agents.get(input.agentId);
    if (existing !== undefined) {
      this.agents.set(input.agentId, { ...existing, status: input.status });
    }
    return {};
  }

  async expireAgents(input: ExpireAgentsInput): Promise<ExpireAgentsOutput> {
    const expired: TaskAgent[] = [];
    for (const agent of this.agents.values()) {
      if (agent.status === 'online' && (agent.lastSeenAt === undefined || agent.lastSeenAt < input.before)) {
        const offline = { ...agent, status: 'offline' as const };
        this.agents.set(agent.agentId, offline);
        expired.push(offline);
      }
    }
    return { agents: expired };
  }
}

/** One command the service asked the hub to deliver. */
export interface SentCommand {
  readonly agentId: string;
  readonly command: AgentCommand;
}

export class FakeAgentCommander implements AgentCommander {
  readonly sent: SentCommand[] = [];
  /** Agents treated as connected. Anything else gets a delivery count of 0. */
  connected = new Set<string>();

  connect(...agentIds: ReadonlyArray<string>): this {
    for (const agentId of agentIds) {
      this.connected.add(agentId);
    }
    return this;
  }

  launchInstance(agentId: string, instruction: LaunchInstruction): number {
    this.sent.push({ agentId, command: { type: 'launch-instance', instruction } });
    return this.connected.has(agentId) ? 1 : 0;
  }

  terminateInstance(agentId: string, instanceId: string, pid: number): number {
    this.sent.push({ agentId, command: { type: 'terminate-instance', instanceId, pid } });
    return this.connected.has(agentId) ? 1 : 0;
  }

  terminateAgent(agentId: string): number {
    this.sent.push({ agentId, command: { type: 'terminate-agent' } });
    return this.connected.has(agentId) ? 1 : 0;
  }

  requestHeartbeat(): number {
    this.sent.push({ agentId: '*', command: { type: 'request-heartbeat' } });
    return this.connected.size;
  }

  /** Every launch instruction sent, in order — what most dispatch assertions want. */
  get launches(): ReadonlyArray<LaunchInstruction> {
    return this.sent.filter((entry) => entry.command.type === 'launch-instance').map((entry) => (entry.command as { instruction: LaunchInstruction }).instruction);
  }
}

/** Holds the version guard, since a stale save being refused is what callers rely on. */
export class FakeDashboardDao implements DashboardDao {
  readonly dashboards = new Map<string, Dashboard>();

  seed(...dashboards: ReadonlyArray<Dashboard>): this {
    for (const dashboard of dashboards) {
      this.dashboards.set(dashboard.name, dashboard);
    }
    return this;
  }

  async listDashboards(): Promise<ListDashboardsOutput> {
    return { dashboards: [...this.dashboards.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }

  async getDashboard(input: GetDashboardInput): Promise<GetDashboardOutput> {
    return { dashboard: this.dashboards.get(input.name) };
  }

  async createDashboard(input: CreateDashboardInput): Promise<CreateDashboardOutput> {
    if (this.dashboards.has(input.name)) {
      return {};
    }
    const dashboard: Dashboard = { ...input, version: 1, createdAt: NOW, updatedAt: NOW };
    this.dashboards.set(input.name, dashboard);
    return { dashboard };
  }

  async updateDashboard(input: UpdateDashboardInput): Promise<UpdateDashboardOutput> {
    const current = this.dashboards.get(input.name);
    if (current === undefined || current.version !== input.version) {
      return {};
    }
    const dashboard: Dashboard = { ...input, version: current.version + 1, createdAt: current.createdAt, updatedAt: NOW };
    this.dashboards.set(input.name, dashboard);
    return { dashboard };
  }

  async deleteDashboard(input: DeleteDashboardInput): Promise<DeleteDashboardOutput> {
    return { deleted: this.dashboards.delete(input.name) };
  }
}

/** Holds the version guard and the state guard, since callers rely on a stale write being refused. */
export class FakeMonitorDao implements MonitorDao {
  readonly monitors = new Map<string, Monitor>();
  readonly changes: MonitorStateChange[] = [];

  seed(...monitors: ReadonlyArray<Monitor>): this {
    for (const monitor of monitors) {
      this.monitors.set(monitor.name, monitor);
    }
    return this;
  }

  async listMonitors(): Promise<ListMonitorsOutput> {
    return { monitors: [...this.monitors.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }

  async getMonitor(input: GetMonitorInput): Promise<GetMonitorOutput> {
    return { monitor: this.monitors.get(input.name) };
  }

  async createMonitor(input: CreateMonitorInput): Promise<CreateMonitorOutput> {
    if (this.monitors.has(input.name)) {
      return {};
    }
    const { stateReason, ...definition } = input;
    const monitor: Monitor = { ...definition, state: 'INSUFFICIENT_DATA', stateReason, stateChangedAt: NOW, version: 1, createdAt: NOW, updatedAt: NOW };
    this.monitors.set(input.name, monitor);
    return { monitor };
  }

  async updateMonitor(input: UpdateMonitorInput): Promise<UpdateMonitorOutput> {
    const current = this.monitors.get(input.name);
    if (current === undefined || current.version !== input.version) {
      return {};
    }
    const monitor: Monitor = { ...current, ...input, version: current.version + 1, updatedAt: NOW };
    this.monitors.set(input.name, monitor);
    return { monitor };
  }

  async deleteMonitor(input: DeleteMonitorInput): Promise<DeleteMonitorOutput> {
    return { deleted: this.monitors.delete(input.name) };
  }

  async markEvaluated(input: MarkEvaluatedInput): Promise<MarkEvaluatedOutput> {
    const current = this.monitors.get(input.name);
    if (current !== undefined) {
      this.monitors.set(input.name, { ...current, lastEvaluatedAt: input.evaluatedAt });
    }
    return {};
  }

  async changeState(input: ChangeStateInput): Promise<ChangeStateOutput> {
    const current = this.monitors.get(input.name);
    if (current === undefined || current.state !== input.fromState || current.version !== input.version) {
      return {};
    }
    this.monitors.set(input.name, { ...current, state: input.toState, stateReason: input.reason, stateChangedAt: input.changedAt, lastEvaluatedAt: input.changedAt });
    const change: MonitorStateChange = {
      monitorName: input.name,
      fromState: input.fromState,
      toState: input.toState,
      reason: input.reason,
      datapoints: input.datapoints,
      threshold: input.threshold,
      changedAt: input.changedAt,
    };
    this.changes.push(change);
    return { change };
  }

  async listStateChanges(input: ListStateChangesInput): Promise<ListStateChangesOutput> {
    return {
      changes: this.changes
        .filter((change) => change.monitorName === input.name)
        .reverse()
        .slice(0, input.limit),
    };
  }
}

/**
 * Holds the unique name, the version guard and the refusal to delete a notifier in use,
 * since callers rely on all three. Which monitors use one comes from `monitorDao`, as the
 * join table would.
 */
export class FakeNotifierDao implements NotifierDao {
  readonly notifiers = new Map<string, Notifier>();
  readonly credentials = new Map<string, NotifierCredentials>();

  constructor(private readonly monitorDao?: FakeMonitorDao) {}

  seed(notifier: Notifier, credentials: NotifierCredentials = { type: 'discord', webhookUrl: `https://discord.com/api/webhooks/1/${notifier.notifierId}` }): this {
    this.notifiers.set(notifier.notifierId, notifier);
    this.credentials.set(notifier.notifierId, credentials);
    return this;
  }

  async listNotifiers(): Promise<ListNotifiersOutput> {
    return { notifiers: [...this.notifiers.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  }

  async getNotifier(input: GetNotifierInput): Promise<GetNotifierOutput> {
    return { notifier: this.notifiers.get(input.notifierId) };
  }

  async createNotifier(input: CreateNotifierInput): Promise<CreateNotifierOutput> {
    if ([...this.notifiers.values()].some((notifier) => notifier.name === input.name)) {
      return {};
    }
    const { credentials, ...rest } = input;
    const notifier: Notifier = { ...rest, version: 1, createdAt: NOW, updatedAt: NOW };
    this.seed(notifier, credentials);
    return { notifier };
  }

  async updateNotifier(input: UpdateNotifierInput): Promise<UpdateNotifierOutput> {
    const current = this.notifiers.get(input.notifierId);
    const nameTaken = [...this.notifiers.values()].some((notifier) => notifier.name === input.name && notifier.notifierId !== input.notifierId);
    if (current === undefined || current.version !== input.version || nameTaken) {
      return {};
    }
    const { credentials, version, ...rest } = input;
    const notifier: Notifier = { ...rest, version: version + 1, createdAt: current.createdAt, updatedAt: NOW };
    this.notifiers.set(input.notifierId, notifier);
    if (credentials !== undefined) {
      this.credentials.set(input.notifierId, credentials);
    }
    return { notifier };
  }

  async deleteNotifier(input: DeleteNotifierInput): Promise<DeleteNotifierOutput> {
    const usedBy = [...(this.monitorDao?.monitors.values() ?? [])]
      .filter((monitor) => monitor.notifierIds.includes(input.notifierId))
      .map((monitor) => monitor.name)
      .sort();
    if (usedBy.length > 0) {
      return { deleted: false, usedBy };
    }
    this.credentials.delete(input.notifierId);
    return { deleted: this.notifiers.delete(input.notifierId), usedBy: [] };
  }

  async listDeliveryTargets(input: ListDeliveryTargetsInput): Promise<ListDeliveryTargetsOutput> {
    return {
      targets: input.notifierIds.flatMap((notifierId) => {
        const notifier = this.notifiers.get(notifierId);
        const credentials = this.credentials.get(notifierId);
        return notifier === undefined || credentials === undefined ? [] : [{ notifier, credentials }];
      }),
    };
  }
}

export function aNotifier(overrides: Partial<Notifier> = {}): Notifier {
  return {
    notifierId: 'ntf-alerts',
    name: 'Alerts',
    target: { type: 'discord', channel: '#alerts', webhookId: '1' },
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

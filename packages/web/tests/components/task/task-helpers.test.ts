import type { Job, Service, TaskAgent, TaskDynamics } from '@mini-cloud/shared';
import { commandLine, nextLaunchAt, resolveTargetAgents } from '@/components/task/task-helpers';

const T0 = Date.UTC(2026, 5, 1, 12, 0, 0);

const aJob = (overrides: Partial<Job> = {}): Job => ({
  taskId: 't1',
  version: 1,
  createdAt: T0,
  lastUpdatedAt: T0,
  name: 'nightly backup',
  cmd: 'backup.sh',
  cwd: '/srv',
  ...overrides,
  type: 'job',
});

const aService = (overrides: Partial<Service> = {}): Service => ({
  taskId: 's1',
  version: 1,
  createdAt: T0,
  lastUpdatedAt: T0,
  name: 'api',
  cmd: 'server.js',
  cwd: '/srv',
  ...overrides,
  type: 'service',
});

const anAgent = (overrides: Partial<TaskAgent> = {}): TaskAgent => ({
  agentId: 'mac-mini',
  name: 'Mac mini',
  status: 'online',
  registeredAt: T0,
  ...overrides,
});

/**
 * This mirrors the scheduler's own arithmetic. It lives in the console because the
 * answer changes every second and a value fetched once would be stale on screen — so
 * the risk is the two drifting apart, and these pin down the same boundary cases the
 * scheduler's own window tests do.
 */
describe('nextLaunchAt', () => {
  it('returns the first launch when it is still ahead', () => {
    expect(nextLaunchAt(aJob({ firstLaunchAt: T0 + 60_000, duration: 5_000 }), T0)).toBe(T0 + 60_000);
  });

  it('returns the first launch when now lands exactly on it', () => {
    expect(nextLaunchAt(aJob({ firstLaunchAt: T0, duration: 5_000 }), T0)).toBe(T0);
  });

  it('projects forward on the cadence once the anchor has passed', () => {
    const job = aJob({ firstLaunchAt: T0, duration: 5_000 });

    expect(nextLaunchAt(job, T0 + 1)).toBe(T0 + 5_000);
    expect(nextLaunchAt(job, T0 + 4_999)).toBe(T0 + 5_000);
    expect(nextLaunchAt(job, T0 + 12_000)).toBe(T0 + 15_000);
  });

  it('moves past an occurrence exactly as it lands, since that one is now firing', () => {
    // Strictly after: showing "next launch" as the moment currently passing would
    // leave the row frozen on a time that has arrived.
    expect(nextLaunchAt(aJob({ firstLaunchAt: T0, duration: 5_000 }), T0 + 5_000)).toBe(T0 + 10_000);
  });

  it('stays correct after a long gap, without accumulating drift', () => {
    const job = aJob({ firstLaunchAt: T0, duration: 3600_000 });

    expect(nextLaunchAt(job, T0 + 30 * 86_400_000 + 1)).toBe(T0 + 30 * 86_400_000 + 3600_000);
  });

  it('returns nothing for a job the scheduler does not launch on a timer', () => {
    expect(nextLaunchAt(aJob(), T0)).toBeUndefined();
    expect(nextLaunchAt(aJob({ firstLaunchAt: T0 }), T0 + 1)).toBeUndefined();
    expect(nextLaunchAt(aJob({ duration: 5_000 }), T0)).toBeUndefined();
  });

  it('returns nothing for a non-positive interval, which would loop forever', () => {
    expect(nextLaunchAt(aJob({ firstLaunchAt: T0, duration: 0 }), T0 + 1)).toBeUndefined();
    expect(nextLaunchAt(aJob({ firstLaunchAt: T0, duration: -1 }), T0 + 1)).toBeUndefined();
  });

  it('returns nothing for a service, which has no schedule at all', () => {
    expect(nextLaunchAt(aService(), T0)).toBeUndefined();
  });
});

describe('commandLine', () => {
  it('joins the command and its arguments as they would be typed', () => {
    expect(commandLine({ cmd: 'backup.sh', arguments: ['--full', '--verbose'] })).toBe('backup.sh --full --verbose');
  });

  it('returns the command alone when there are no arguments', () => {
    expect(commandLine({ cmd: 'backup.sh' })).toBe('backup.sh');
    // No trailing space: the value is offered for copying into a shell.
    expect(commandLine({ cmd: 'backup.sh', arguments: [] })).toBe('backup.sh');
  });
});

/**
 * The join that matters: a targeted agent missing from the fleet still has to appear.
 * Dropping it silently would hide the reason a scheduled task has stopped launching.
 */
describe('resolveTargetAgents', () => {
  it('marks which of the fleet a task targets', () => {
    const agents = [anAgent({ agentId: 'a', name: 'A' }), anAgent({ agentId: 'b', name: 'B' })];
    const dynamics: TaskDynamics = { taskId: 't1', active: true, targetAgentIds: ['a'] };

    expect(resolveTargetAgents(agents, dynamics)).toEqual([
      { agentId: 'a', name: 'A', status: 'online', targeted: true },
      { agentId: 'b', name: 'B', status: 'online', targeted: false },
    ]);
  });

  it("carries each agent's status through, so an offline target is visible", () => {
    const agents = [anAgent({ agentId: 'a', status: 'offline' })];
    const dynamics: TaskDynamics = { taskId: 't1', active: true, targetAgentIds: ['a'] };

    expect(resolveTargetAgents(agents, dynamics)[0]).toMatchObject({ status: 'offline', targeted: true });
  });

  it('keeps a targeted agent that is no longer in the fleet, marked offline', () => {
    const dynamics: TaskDynamics = { taskId: 't1', active: true, targetAgentIds: ['retired'] };

    expect(resolveTargetAgents([], dynamics)).toEqual([{ agentId: 'retired', status: 'offline', targeted: true }]);
  });

  it('lists the fleet first and the missing targets after it', () => {
    const agents = [anAgent({ agentId: 'a', name: 'A' })];
    const dynamics: TaskDynamics = { taskId: 't1', active: true, targetAgentIds: ['a', 'retired'] };

    expect(resolveTargetAgents(agents, dynamics).map((agent) => agent.agentId)).toEqual(['a', 'retired']);
  });

  it('does not list an agent twice when it is both targeted and present', () => {
    const agents = [anAgent({ agentId: 'a' })];
    const dynamics: TaskDynamics = { taskId: 't1', active: true, targetAgentIds: ['a'] };

    expect(resolveTargetAgents(agents, dynamics)).toHaveLength(1);
  });

  it('treats a task with no dynamics as targeting nobody', () => {
    const agents = [anAgent({ agentId: 'a', name: 'A' })];

    // A task that has never been scheduled has no dynamics row; every agent should
    // then show as available and none as selected.
    expect(resolveTargetAgents(agents, undefined)).toEqual([{ agentId: 'a', name: 'A', status: 'online', targeted: false }]);
  });

  it('renders nothing rather than failing while the fleet is still loading', () => {
    // Both arrive from separate queries, so either can be undefined on first paint.
    expect(resolveTargetAgents(undefined, undefined)).toEqual([]);
    expect(resolveTargetAgents(undefined, { taskId: 't1', active: true, targetAgentIds: ['a'] })).toEqual([{ agentId: 'a', status: 'offline', targeted: true }]);
  });
});

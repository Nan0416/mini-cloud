import { LoggerFactory, TaskAgent, TaskInstance } from '@mini-cloud/shared';
import { Scheduler, SchedulerConfig } from '../../src/facades/scheduler';
import { TaskDispatcher } from '../../src/facades/task-dispatcher';
import { FakeAgentCommander, FakeAgentDao, FakeTaskDao, FakeTaskEventDao, FakeTaskInstanceDao, FakeVariableDao, NOW, aJob } from '../data/fake-daos';

const CONFIG: SchedulerConfig = {
  jobTickMs: 1_000,
  maintenanceTickMs: 5_000,
  agentOfflineAfterMs: 15_000,
  launchTimeoutMs: 15_000,
  startTimeoutMs: 60_000,
  retentionDays: 365,
  retentionTickMs: 3600_000,
};

const build = (config: Partial<SchedulerConfig> = {}) => {
  const taskDao = new FakeTaskDao();
  const taskInstanceDao = new FakeTaskInstanceDao();
  const taskEventDao = new FakeTaskEventDao();
  const agentDao = new FakeAgentDao();
  const variableDao = new FakeVariableDao();
  const agentCommander = new FakeAgentCommander();
  const taskDispatcher = new TaskDispatcher({ taskInstanceDao, taskEventDao, agentCommander });
  const scheduler = new Scheduler({
    taskDao,
    taskInstanceDao,
    taskEventDao,
    agentDao,
    variableDao,
    agentCommander,
    taskDispatcher,
    config: { ...CONFIG, ...config },
  });
  return { taskDao, taskInstanceDao, taskEventDao, agentDao, variableDao, agentCommander, scheduler };
};

const anAgent = (overrides: Partial<TaskAgent> = {}): TaskAgent => ({
  agentId: 'mac-mini',
  name: 'Mac mini',
  status: 'online',
  lastSeenAt: NOW,
  registeredAt: NOW,
  ...overrides,
});

const anInstance = (overrides: Partial<TaskInstance>): TaskInstance => ({
  instanceId: 'i1',
  taskId: 't1',
  taskVersion: 1,
  agentId: 'mac-mini',
  status: 'initiated',
  createdAt: NOW,
  lastUpdatedAt: NOW,
  ...overrides,
});

/**
 * Every test here runs on a frozen clock. The scheduler's whole job is expressed in
 * terms of wall-clock time — window boundaries, three timeout thresholds, a retention
 * horizon — so a real clock makes the interesting cases either unreachable (a window
 * that opens and closes within the same millisecond contains nothing) or flaky.
 */
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** Moves the clock without firing any timers. */
const advance = (ms: number): void => {
  jest.setSystemTime(Date.now() + ms);
};

/** Opens a window at the current time, the way a real start would, then stands down. */
const openWindowAt = (scheduler: Scheduler): void => {
  scheduler.start();
  scheduler.stop();
};

const silenceSchedulerErrors = (): jest.SpyInstance => jest.spyOn(LoggerFactory.getLogger('Scheduler'), 'error').mockImplementation(() => undefined);

describe('Scheduler.start and stop', () => {
  it('runs each loop on its own interval', async () => {
    const { taskDao, agentCommander, scheduler } = build();
    const listScheduledJobs = jest.spyOn(taskDao, 'listScheduledJobs');

    scheduler.start();
    // The async variant, because a tick is a promise: advancing synchronously would
    // fire all three intervals before the first tick had a chance to finish, and the
    // reentrancy guard would then legitimately skip two of them.
    await jest.advanceTimersByTimeAsync(3_000);

    // Three job ticks at 1s, but no maintenance tick yet at 5s — probing every agent
    // once a second would be pure traffic.
    expect(listScheduledJobs).toHaveBeenCalledTimes(3);
    expect(agentCommander.sent).toEqual([]);
    scheduler.stop();
  });

  it('runs the maintenance loop on its own, slower interval', async () => {
    const { agentCommander, scheduler } = build();

    scheduler.start();
    await jest.advanceTimersByTimeAsync(11_000);

    expect(agentCommander.sent).toHaveLength(2);
    scheduler.stop();
  });

  it('stops every loop, so a shutdown does not leave timers holding the process open', async () => {
    const { taskDao, agentCommander, scheduler } = build();
    const listScheduledJobs = jest.spyOn(taskDao, 'listScheduledJobs');

    scheduler.start();
    await jest.advanceTimersByTimeAsync(6_000);
    scheduler.stop();
    const ticksAtStop = listScheduledJobs.mock.calls.length;
    const commandsAtStop = agentCommander.sent.length;
    await jest.advanceTimersByTimeAsync(60_000);

    expect(ticksAtStop).toBeGreaterThan(0);
    expect(listScheduledJobs).toHaveBeenCalledTimes(ticksAtStop);
    expect(agentCommander.sent).toHaveLength(commandsAtStop);
  });

  it('is safe to stop without having started', () => {
    const { scheduler } = build();

    expect(() => scheduler.stop()).not.toThrow();
  });

  it('is safe to stop twice', () => {
    const { scheduler } = build();

    scheduler.start();
    scheduler.stop();

    expect(() => scheduler.stop()).not.toThrow();
  });
});

/**
 * The window invariant: a tick covers `[windowStart, now)`, and the next window opens
 * where this one closed. Contiguous and non-overlapping is what makes a job fire
 * exactly once per occurrence, even though the tick interval and the job interval have
 * nothing to do with each other.
 */
describe('Scheduler.runJobTick', () => {
  it('launches a job whose occurrence falls inside the window', async () => {
    const { taskDao, agentCommander, scheduler } = build();
    agentCommander.connect('mac-mini');
    openWindowAt(scheduler);
    taskDao.scheduledJobs = [{ job: aJob({ firstLaunchAt: NOW + 500, duration: 5_000 }), targetAgentIds: ['mac-mini'] }];

    advance(2_000);
    await scheduler.runJobTick();

    expect(agentCommander.launches).toHaveLength(1);
    expect(agentCommander.launches[0]?.taskId).toBe('t1');
  });

  it('does not launch a job whose next occurrence is still ahead', async () => {
    const { taskDao, agentCommander, scheduler } = build();
    agentCommander.connect('mac-mini');
    openWindowAt(scheduler);
    taskDao.scheduledJobs = [{ job: aJob({ firstLaunchAt: NOW + 3600_000 }), targetAgentIds: ['mac-mini'] }];

    advance(2_000);
    await scheduler.runJobTick();

    expect(agentCommander.launches).toEqual([]);
  });

  it('does not launch a job whose occurrence fell in an earlier window', async () => {
    const { taskDao, agentCommander, scheduler } = build();
    agentCommander.connect('mac-mini');
    openWindowAt(scheduler);
    // Anchored before the window opened, and one-shot, so it has no occurrence left.
    taskDao.scheduledJobs = [{ job: aJob({ firstLaunchAt: NOW - 60_000 }), targetAgentIds: ['mac-mini'] }];

    advance(2_000);
    await scheduler.runJobTick();

    expect(agentCommander.launches).toEqual([]);
  });

  it('fires a one-shot job once and never again', async () => {
    const { taskDao, agentCommander, scheduler } = build();
    agentCommander.connect('mac-mini');
    openWindowAt(scheduler);
    taskDao.scheduledJobs = [{ job: aJob({ firstLaunchAt: NOW + 500 }), targetAgentIds: ['mac-mini'] }];

    for (let tick = 0; tick < 5; tick += 1) {
      advance(1_000);
      await scheduler.runJobTick();
    }

    // Windows are contiguous, so the occurrence belongs to exactly one of them.
    expect(agentCommander.launches).toHaveLength(1);
  });

  it('fires a recurring job once per occurrence across contiguous windows', async () => {
    const { taskDao, agentCommander, scheduler } = build();
    agentCommander.connect('mac-mini');
    openWindowAt(scheduler);
    // Occurrences at NOW+1000, +6000, +11000, ...
    taskDao.scheduledJobs = [{ job: aJob({ firstLaunchAt: NOW + 1_000, duration: 5_000 }), targetAgentIds: ['mac-mini'] }];

    // Twelve one-second ticks span NOW..NOW+12000, containing three occurrences.
    for (let tick = 0; tick < 12; tick += 1) {
      advance(1_000);
      await scheduler.runJobTick();
    }

    expect(agentCommander.launches).toHaveLength(3);
  });

  it('fires once, not the whole backlog, after a long pause', async () => {
    const { taskDao, agentCommander, scheduler } = build();
    agentCommander.connect('mac-mini');
    openWindowAt(scheduler);
    taskDao.scheduledJobs = [{ job: aJob({ firstLaunchAt: NOW + 1_000, duration: 5_000 }), targetAgentIds: ['mac-mini'] }];

    // A day's outage holds seventeen thousand occurrences; launching them all at once
    // is worse than skipping them.
    advance(86_400_000);
    await scheduler.runJobTick();

    expect(agentCommander.launches).toHaveLength(1);
  });

  it('launches on every agent the job targets', async () => {
    const { taskDao, agentCommander, scheduler } = build();
    agentCommander.connect('a', 'b');
    openWindowAt(scheduler);
    taskDao.scheduledJobs = [{ job: aJob({ firstLaunchAt: NOW + 500 }), targetAgentIds: ['a', 'b'] }];

    advance(2_000);
    await scheduler.runJobTick();

    expect(agentCommander.sent.map((entry) => entry.agentId)).toEqual(['a', 'b']);
  });

  it('reads the variable set once per tick, not once per job', async () => {
    const { taskDao, variableDao, agentCommander, scheduler } = build();
    agentCommander.connect('a');
    openWindowAt(scheduler);
    const listVariables = jest.spyOn(variableDao, 'listVariables');
    taskDao.scheduledJobs = [
      { job: aJob({ taskId: 'a', firstLaunchAt: NOW + 500 }), targetAgentIds: ['a'] },
      { job: aJob({ taskId: 'b', firstLaunchAt: NOW + 500 }), targetAgentIds: ['a'] },
    ];

    advance(2_000);
    await scheduler.runJobTick();

    expect(agentCommander.launches).toHaveLength(2);
    expect(listVariables).toHaveBeenCalledTimes(1);
  });

  it('does not read the variable set at all when nothing is due', async () => {
    const { variableDao, scheduler } = build();
    openWindowAt(scheduler);
    const listVariables = jest.spyOn(variableDao, 'listVariables');

    advance(2_000);
    await scheduler.runJobTick();

    // This runs once a second forever; a round trip per idle tick buys nothing.
    expect(listVariables).not.toHaveBeenCalled();
  });

  it('resolves variables into the launches it dispatches', async () => {
    const { taskDao, variableDao, agentCommander, scheduler } = build();
    agentCommander.connect('a');
    variableDao.seed({ ROOT: '/srv/app' });
    openWindowAt(scheduler);
    taskDao.scheduledJobs = [{ job: aJob({ cmd: '${ROOT}/backup.sh', firstLaunchAt: NOW + 500 }), targetAgentIds: ['a'] }];

    advance(2_000);
    await scheduler.runJobTick();

    expect(agentCommander.launches[0]?.cmd).toBe('/srv/app/backup.sh');
  });

  it('skips a tick while the previous one is still running', async () => {
    const { taskDao, scheduler } = build();
    let release = (): void => undefined;
    const listScheduledJobs = jest.spyOn(taskDao, 'listScheduledJobs').mockImplementation(() => new Promise((resolve) => (release = () => resolve({ scheduledJobs: [] }))));

    const first = scheduler.runJobTick();
    await scheduler.runJobTick();

    // Two concurrent ticks would share a window and launch the same job twice.
    expect(listScheduledJobs).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  it('accepts a new tick once the previous one has finished', async () => {
    const { taskDao, scheduler } = build();
    const listScheduledJobs = jest.spyOn(taskDao, 'listScheduledJobs');

    await scheduler.runJobTick();
    await scheduler.runJobTick();

    expect(listScheduledJobs).toHaveBeenCalledTimes(2);
  });

  it('retries the same window after a failure instead of skipping its launches', async () => {
    const { taskDao, agentCommander, scheduler } = build();
    agentCommander.connect('a');
    silenceSchedulerErrors();
    openWindowAt(scheduler);
    taskDao.scheduledJobs = [{ job: aJob({ firstLaunchAt: NOW + 500 }), targetAgentIds: ['a'] }];

    advance(2_000);
    taskDao.failNext = new Error('connection terminated');
    await scheduler.runJobTick();
    expect(agentCommander.launches).toEqual([]);

    // The window did not advance, so the occurrence inside it is still pending.
    // Advancing on failure would silently drop every launch that window contained.
    await scheduler.runJobTick();
    expect(agentCommander.launches).toHaveLength(1);
  });

  it('survives a failing tick rather than letting the loop die', async () => {
    const { taskDao, scheduler } = build();
    const error = silenceSchedulerErrors();
    taskDao.failNext = new Error('connection terminated');

    // `setInterval` swallows nothing: an unhandled rejection here would be an
    // unhandled rejection at the top level rather than a retried tick.
    await expect(scheduler.runJobTick()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it('releases the running flag after a failure, so the loop is not wedged', async () => {
    const { taskDao, scheduler } = build();
    silenceSchedulerErrors();
    const listScheduledJobs = jest.spyOn(taskDao, 'listScheduledJobs');
    taskDao.failNext = new Error('connection terminated');

    await scheduler.runJobTick();
    await scheduler.runJobTick();

    expect(listScheduledJobs).toHaveBeenCalledTimes(2);
  });
});

describe('Scheduler.runMaintenanceTick', () => {
  it('probes the fleet for heartbeats', async () => {
    const { agentCommander, scheduler } = build();

    await scheduler.runMaintenanceTick();

    expect(agentCommander.sent).toEqual([{ agentId: '*', command: { type: 'request-heartbeat' } }]);
  });

  it('marks an agent that stopped heartbeating as offline', async () => {
    const { agentDao, scheduler } = build();
    agentDao.seed(anAgent({ lastSeenAt: NOW - 60_000 }));

    await scheduler.runMaintenanceTick();

    expect(agentDao.agents.get('mac-mini')?.status).toBe('offline');
  });

  it('leaves a recently seen agent online', async () => {
    const { agentDao, scheduler } = build();
    agentDao.seed(anAgent({ lastSeenAt: NOW - 1_000 }));

    await scheduler.runMaintenanceTick();

    // The window is three maintenance ticks wide, so one slow tick does not flap an
    // agent offline and straight back on.
    expect(agentDao.agents.get('mac-mini')?.status).toBe('online');
  });

  it('expires an agent that registered but never checked in', async () => {
    const { agentDao, scheduler } = build();
    agentDao.seed(anAgent({ lastSeenAt: undefined }));

    await scheduler.runMaintenanceTick();

    expect(agentDao.agents.get('mac-mini')?.status).toBe('offline');
  });

  it('fails an instance the agent never acknowledged', async () => {
    const { taskInstanceDao, taskEventDao, scheduler } = build();
    taskInstanceDao.seed(anInstance({ status: 'initiated', lastUpdatedAt: NOW - 60_000 }));

    await scheduler.runMaintenanceTick();

    // Otherwise it sits at `initiated` forever and the launch simply vanishes.
    expect(taskInstanceDao.statusOf('i1')).toBe('launching_timeout');
    expect(taskEventDao.payloadsFor('i1')).toEqual([expect.stringContaining('did not acknowledge the launch')]);
    expect(taskEventDao.events[0]).toMatchObject({ source: 'service', level: 'error' });
  });

  it('fails an instance that spawned but never reported a pid', async () => {
    const { taskInstanceDao, taskEventDao, scheduler } = build();
    taskInstanceDao.seed(anInstance({ status: 'launched', lastUpdatedAt: NOW - 120_000 }));

    await scheduler.runMaintenanceTick();

    expect(taskInstanceDao.statusOf('i1')).toBe('start_timeout');
    // The message names where to look, because this is almost always a bad cwd or a
    // command that is not executable.
    expect(taskEventDao.payloadsFor('i1')).toEqual([expect.stringContaining("Check the task's cwd, command and stderr")]);
  });

  it('leaves an instance still inside its timeout alone', async () => {
    const { taskInstanceDao, scheduler } = build();
    taskInstanceDao.seed(anInstance({ status: 'initiated', lastUpdatedAt: NOW - 1_000 }));

    await scheduler.runMaintenanceTick();

    expect(taskInstanceDao.statusOf('i1')).toBe('initiated');
  });

  it('applies each timeout to its own status only', async () => {
    const { taskInstanceDao, scheduler } = build();
    // 30s is past the 15s launch timeout but well inside the 60s start timeout.
    taskInstanceDao.seed(
      anInstance({ instanceId: 'never-acked', status: 'initiated', lastUpdatedAt: NOW - 30_000 }),
      anInstance({ instanceId: 'never-started', status: 'launched', lastUpdatedAt: NOW - 30_000 }),
    );

    await scheduler.runMaintenanceTick();

    expect(taskInstanceDao.statusOf('never-acked')).toBe('launching_timeout');
    expect(taskInstanceDao.statusOf('never-started')).toBe('launched');
  });

  it('sweeps every stuck instance, not just the first', async () => {
    const { taskInstanceDao, scheduler } = build();
    taskInstanceDao.seed(
      anInstance({ instanceId: 'a', status: 'initiated', lastUpdatedAt: NOW - 60_000 }),
      anInstance({ instanceId: 'b', status: 'initiated', lastUpdatedAt: NOW - 60_000 }),
    );

    await scheduler.runMaintenanceTick();

    expect([taskInstanceDao.statusOf('a'), taskInstanceDao.statusOf('b')]).toEqual(['launching_timeout', 'launching_timeout']);
  });

  it('skips a tick while the previous one is still running', async () => {
    const { agentDao, agentCommander, scheduler } = build();
    let release = (): void => undefined;
    jest.spyOn(agentDao, 'expireAgents').mockImplementation(() => new Promise((resolve) => (release = () => resolve({ agents: [] }))));

    const first = scheduler.runMaintenanceTick();
    await scheduler.runMaintenanceTick();

    expect(agentCommander.sent).toHaveLength(1);
    release();
    await first;
  });

  it('survives a failing tick', async () => {
    const { agentDao, scheduler } = build();
    const error = silenceSchedulerErrors();
    jest.spyOn(agentDao, 'expireAgents').mockRejectedValue(new Error('connection terminated'));

    await expect(scheduler.runMaintenanceTick()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });

  it('releases the running flag after a failure, so the loop is not wedged', async () => {
    const { agentDao, agentCommander, scheduler } = build();
    silenceSchedulerErrors();
    const expireAgents = jest.spyOn(agentDao, 'expireAgents').mockRejectedValueOnce(new Error('connection terminated'));

    await scheduler.runMaintenanceTick();
    expireAgents.mockResolvedValue({ agents: [] });
    await scheduler.runMaintenanceTick();

    // A flag left set by an error path would silently stop maintenance forever.
    expect(agentCommander.sent).toHaveLength(2);
  });
});

describe('Scheduler.runRetentionTick', () => {
  it('deletes instances older than the retention window', async () => {
    const { taskInstanceDao, scheduler } = build({ retentionDays: 1 });
    taskInstanceDao.seed(
      anInstance({ instanceId: 'old', status: 'exit_success', lastUpdatedAt: NOW - 2 * 86_400_000 }),
      anInstance({ instanceId: 'recent', status: 'exit_success', lastUpdatedAt: NOW }),
    );

    await scheduler.runRetentionTick();

    expect([...taskInstanceDao.instances.keys()]).toEqual(['recent']);
  });

  it('keeps a year by default, so nothing disappears unexpectedly', async () => {
    const { taskInstanceDao, scheduler } = build();
    taskInstanceDao.seed(anInstance({ status: 'exit_success', lastUpdatedAt: NOW - 300 * 86_400_000 }));

    await scheduler.runRetentionTick();

    expect(taskInstanceDao.instances.has('i1')).toBe(true);
  });

  it('measures retention from the last update, not from creation', async () => {
    const { taskInstanceDao, scheduler } = build({ retentionDays: 1 });
    // A long-running service started a week ago but still reporting today.
    taskInstanceDao.seed(anInstance({ status: 'running', createdAt: NOW - 7 * 86_400_000, lastUpdatedAt: NOW }));

    await scheduler.runRetentionTick();

    expect(taskInstanceDao.instances.has('i1')).toBe(true);
  });

  it('survives a failing tick', async () => {
    const { taskInstanceDao, scheduler } = build();
    const error = silenceSchedulerErrors();
    jest.spyOn(taskInstanceDao, 'deleteInstancesUpdatedBefore').mockRejectedValue(new Error('connection terminated'));

    await expect(scheduler.runRetentionTick()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});

import type { Task, TaskAgent, TaskDynamics } from '@mini-cloud/shared';

/**
 * When the scheduler will next launch a job, or `undefined` for anything it does not
 * launch on a timer.
 *
 * Mirrors the scheduler's own arithmetic: occurrences sit at
 * `firstLaunchAt + n * duration`, so the next one is the first of those strictly
 * after now. Computed here rather than served by the API because the answer changes
 * every second and a value fetched once would be stale on screen.
 */
export function nextLaunchAt(task: Task, now: number = Date.now()): number | undefined {
  if (task.type !== 'job' || task.duration === undefined || task.firstLaunchAt === undefined || task.duration <= 0) {
    return undefined;
  }
  if (now <= task.firstLaunchAt) {
    return task.firstLaunchAt;
  }
  const elapsed = now - task.firstLaunchAt;
  const occurrences = Math.floor(elapsed / task.duration) + 1;
  return task.firstLaunchAt + occurrences * task.duration;
}

/** The full command line as it would be typed, for display and copying. */
export function commandLine(task: Pick<Task, 'cmd' | 'arguments'>): string {
  if (task.arguments === undefined || task.arguments.length === 0) {
    return task.cmd;
  }
  return `${task.cmd} ${task.arguments.join(' ')}`;
}

export interface TargetAgent {
  readonly agentId: string;
  readonly name?: string;
  readonly status: TaskAgent['status'];
  readonly targeted: boolean;
}

/**
 * Joins the fleet against a task's target list.
 *
 * A targeted agent that is no longer in the fleet still appears, marked offline:
 * silently dropping it would hide the reason a scheduled task has stopped launching.
 */
export function resolveTargetAgents(agents: ReadonlyArray<TaskAgent> | undefined, dynamics: TaskDynamics | undefined): ReadonlyArray<TargetAgent> {
  const targeted = new Set(dynamics?.targetAgentIds ?? []);
  const known = (agents ?? []).map((agent) => ({
    agentId: agent.agentId,
    name: agent.name,
    status: agent.status,
    targeted: targeted.has(agent.agentId),
  }));

  const knownIds = new Set(known.map((agent) => agent.agentId));
  const missing: ReadonlyArray<TargetAgent> = Array.from(targeted)
    .filter((agentId) => !knownIds.has(agentId))
    .map((agentId) => ({ agentId, status: 'offline', targeted: true }));

  return [...known, ...missing];
}

/** A half-open interval `[from, to)` of wall-clock time, in epoch ms. */
export interface LaunchWindow {
  readonly from: number;
  readonly to: number;
}

export interface JobSchedule {
  /** Epoch ms of the first scheduled launch. Absent means manual-launch only. */
  readonly firstLaunchAt?: number;
  /** Interval between launches, in ms. Absent means launch once, at `firstLaunchAt`. */
  readonly duration?: number;
}

/**
 * The first scheduled launch at or after `t`, or undefined if there is none.
 *
 * Derived arithmetically from `firstLaunchAt` and `duration` rather than stored as a
 * "next run" column, which means the scheduler holds no state that could drift, and
 * a service that was down for a week resumes on the correct cadence with nothing to
 * reconcile.
 */
export function nextLaunchAtOrAfter(schedule: JobSchedule, t: number): number | undefined {
  const { firstLaunchAt, duration } = schedule;
  if (firstLaunchAt === undefined) {
    return undefined;
  }
  if (firstLaunchAt >= t) {
    return firstLaunchAt;
  }
  if (duration === undefined || duration <= 0) {
    // A one-shot job whose moment has passed.
    return undefined;
  }
  const periods = Math.ceil((t - firstLaunchAt) / duration);
  return firstLaunchAt + periods * duration;
}

/**
 * Whether a launch falls inside `window`.
 *
 * At most one launch is reported per window even if several occurrences fit inside
 * it. That only happens when the service was paused for longer than the job's
 * interval, and firing the whole backlog at once is worse than skipping it.
 */
export function shouldLaunchInWindow(schedule: JobSchedule, window: LaunchWindow): boolean {
  const next = nextLaunchAtOrAfter(schedule, window.from);
  return next !== undefined && next < window.to;
}

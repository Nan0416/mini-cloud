import { nextLaunchAtOrAfter, shouldLaunchInWindow } from '../src/services/job-window';

describe('nextLaunchAtOrAfter', () => {
  it('returns nothing for a job with no schedule', () => {
    expect(nextLaunchAtOrAfter({}, 1_000)).toBeUndefined();
    expect(nextLaunchAtOrAfter({ duration: 5_000 }, 1_000)).toBeUndefined();
  });

  it('returns the first launch when it is still in the future', () => {
    expect(nextLaunchAtOrAfter({ firstLaunchAt: 5_000 }, 1_000)).toBe(5_000);
    expect(nextLaunchAtOrAfter({ firstLaunchAt: 5_000, duration: 1_000 }, 1_000)).toBe(5_000);
  });

  it('returns the first launch when the reference time lands exactly on it', () => {
    expect(nextLaunchAtOrAfter({ firstLaunchAt: 5_000 }, 5_000)).toBe(5_000);
  });

  it('returns nothing for a one-shot job whose moment has passed', () => {
    expect(nextLaunchAtOrAfter({ firstLaunchAt: 5_000 }, 5_001)).toBeUndefined();
  });

  it('projects the recurrence forward without storing any state', () => {
    // Anchored at 6ms on a 5ms cadence: occurrences are 6, 11, 16, ... 101, 106.
    expect(nextLaunchAtOrAfter({ firstLaunchAt: 6, duration: 5 }, 100)).toBe(101);
    expect(nextLaunchAtOrAfter({ firstLaunchAt: 6, duration: 5 }, 101)).toBe(101);
    expect(nextLaunchAtOrAfter({ firstLaunchAt: 6, duration: 5 }, 102)).toBe(106);
  });

  it('projects correctly across a long outage', () => {
    const day = 24 * 3600_000;
    // Anchored at epoch 0 on a daily cadence, asked 30.5 days later.
    expect(nextLaunchAtOrAfter({ firstLaunchAt: 0, duration: day }, 30.5 * day)).toBe(31 * day);
  });

  it('treats a non-positive interval as no recurrence rather than looping forever', () => {
    expect(nextLaunchAtOrAfter({ firstLaunchAt: 10, duration: 0 }, 100)).toBeUndefined();
    expect(nextLaunchAtOrAfter({ firstLaunchAt: 10, duration: -5 }, 100)).toBeUndefined();
  });
});

describe('shouldLaunchInWindow', () => {
  it('fires when the first launch falls inside the window', () => {
    expect(shouldLaunchInWindow({ firstLaunchAt: 150 }, { from: 100, to: 200 })).toBe(true);
  });

  it('treats the window as half-open so consecutive windows never double-fire', () => {
    const schedule = { firstLaunchAt: 200 };
    expect(shouldLaunchInWindow(schedule, { from: 100, to: 200 })).toBe(false);
    expect(shouldLaunchInWindow(schedule, { from: 200, to: 300 })).toBe(true);
  });

  it('does not fire before the first launch', () => {
    expect(shouldLaunchInWindow({ firstLaunchAt: 500, duration: 100 }, { from: 100, to: 200 })).toBe(false);
  });

  it('fires exactly once per occurrence across contiguous windows', () => {
    const schedule = { firstLaunchAt: 0, duration: 1_000 };
    let fired = 0;
    // Tick every 250ms across exactly [0, 10_000): occurrences are 0, 1000 ... 9000,
    // so the job should fire ten times and the 40 ticks in between should be no-ops.
    for (let from = 0; from < 10_000; from += 250) {
      if (shouldLaunchInWindow(schedule, { from, to: from + 250 })) {
        fired += 1;
      }
    }
    expect(fired).toBe(10);
  });

  it('coalesces a backlog into a single launch when a window outruns the interval', () => {
    // The service was paused for an hour on a job that runs every 5 seconds. Firing
    // 720 catch-up launches would be worse than firing one.
    expect(shouldLaunchInWindow({ firstLaunchAt: 0, duration: 5_000 }, { from: 0, to: 3600_000 })).toBe(true);
  });

  it('does not fire for a manual-only job', () => {
    expect(shouldLaunchInWindow({}, { from: 0, to: Number.MAX_SAFE_INTEGER })).toBe(false);
  });
});

import type { MonitorState, MonitorStateChange } from '@mini-cloud/shared';
import { stateBands } from '@/lib/monitor-bands';

const HOUR = 3_600_000;
const T = Date.UTC(2026, 9, 1);

function aChange(fromState: MonitorState, toState: MonitorState, changedAt: number): MonitorStateChange {
  return { monitorName: 'nas-cpu', fromState, toState, reason: 'r', datapoints: [], threshold: 80, changedAt };
}

/** Bands for a window, from that same window's history. */
function bandsIn(changes: ReadonlyArray<MonitorStateChange>, createdAt: number, from: number, to: number) {
  return stateBands({ history: { name: 'nas-cpu', from, to, changes }, name: 'nas-cpu', createdAt, from, to });
}

describe('stateBands', () => {
  it('shades alarm and insufficient data between the changes that bound them, and leaves OK bare', () => {
    const changes = [
      aChange('INSUFFICIENT_DATA', 'OK', T - 9 * HOUR),
      aChange('OK', 'ALARM', T + 2 * HOUR),
      aChange('ALARM', 'INSUFFICIENT_DATA', T + 3 * HOUR),
      aChange('INSUFFICIENT_DATA', 'OK', T + 4 * HOUR),
    ];

    expect(bandsIn(changes, T - 10 * HOUR, T, T + 6 * HOUR)).toEqual([
      { from: T + 2 * HOUR, to: T + 3 * HOUR, tone: 'alarm' },
      { from: T + 3 * HOUR, to: T + 4 * HOUR, tone: 'muted' },
    ]);
  });

  it('opens the window in the state of the last change before it, and runs the current one to the end', () => {
    const changes = [aChange('ALARM', 'OK', T + HOUR), aChange('OK', 'ALARM', T - HOUR), aChange('INSUFFICIENT_DATA', 'OK', T - 5 * HOUR), aChange('OK', 'ALARM', T + 5 * HOUR)];

    expect(bandsIn(changes, T - 10 * HOUR, T, T + 6 * HOUR)).toEqual([
      { from: T, to: T + HOUR, tone: 'alarm' },
      { from: T + 5 * HOUR, to: T + 6 * HOUR, tone: 'alarm' },
    ]);
  });

  it('shades a new monitor as short of data from its creation until its first change, and not before', () => {
    const changes = [aChange('INSUFFICIENT_DATA', 'OK', T + 2 * HOUR)];

    expect(bandsIn(changes, T + HOUR, T, T + 6 * HOUR)).toEqual([{ from: T + HOUR, to: T + 2 * HOUR, tone: 'muted' }]);
  });

  it('shades a window from before the first change as short of data, whatever the monitor is in now', () => {
    // A monitor in alarm now, whose first change came after this window: the history for it is empty.
    expect(bandsIn([], T - HOUR, T, T + HOUR)).toEqual([{ from: T, to: T + HOUR, tone: 'muted' }]);
  });

  it('shades only the part of the window an earlier answer covers, while the new one loads', () => {
    // Widened from the last hour to the last six: the hour's history says nothing of the five before it.
    const history = { name: 'nas-cpu', from: T + 5 * HOUR, to: T + 6 * HOUR, changes: [aChange('INSUFFICIENT_DATA', 'ALARM', T - 10 * HOUR)] };

    expect(stateBands({ history, name: 'nas-cpu', createdAt: T - 20 * HOUR, from: T, to: T + 6 * HOUR })).toEqual([{ from: T + 5 * HOUR, to: T + 6 * HOUR, tone: 'alarm' }]);
  });

  it('shades nothing from another monitor’s history', () => {
    const history = { name: 'nas-disk', from: T, to: T + HOUR, changes: [aChange('INSUFFICIENT_DATA', 'ALARM', T - HOUR)] };

    expect(stateBands({ history, name: 'nas-cpu', createdAt: T - 2 * HOUR, from: T, to: T + HOUR })).toEqual([]);
  });
});

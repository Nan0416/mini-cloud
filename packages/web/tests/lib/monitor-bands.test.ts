import type { MonitorState, MonitorStateChange } from '@mini-cloud/shared';
import { stateBands } from '@/lib/monitor-bands';

const HOUR = 3_600_000;
const T = Date.UTC(2026, 9, 1);

function aChange(fromState: MonitorState, toState: MonitorState, changedAt: number): MonitorStateChange {
  return { monitorName: 'nas-cpu', fromState, toState, reason: 'r', datapoints: [], threshold: 80, changedAt };
}

describe('stateBands', () => {
  it('shades alarm and insufficient data between the changes that bound them, and leaves OK bare', () => {
    const changes = [
      aChange('INSUFFICIENT_DATA', 'OK', T - 9 * HOUR),
      aChange('OK', 'ALARM', T + 2 * HOUR),
      aChange('ALARM', 'INSUFFICIENT_DATA', T + 3 * HOUR),
      aChange('INSUFFICIENT_DATA', 'OK', T + 4 * HOUR),
    ];

    expect(stateBands({ changes, createdAt: T - 10 * HOUR, from: T, to: T + 6 * HOUR })).toEqual([
      { from: T + 2 * HOUR, to: T + 3 * HOUR, tone: 'alarm' },
      { from: T + 3 * HOUR, to: T + 4 * HOUR, tone: 'muted' },
    ]);
  });

  it('opens the window in the state of the last change before it, and runs the current one to the end', () => {
    const changes = [aChange('ALARM', 'OK', T + HOUR), aChange('OK', 'ALARM', T - HOUR), aChange('INSUFFICIENT_DATA', 'OK', T - 5 * HOUR), aChange('OK', 'ALARM', T + 5 * HOUR)];

    expect(stateBands({ changes, createdAt: T - 10 * HOUR, from: T, to: T + 6 * HOUR })).toEqual([
      { from: T, to: T + HOUR, tone: 'alarm' },
      { from: T + 5 * HOUR, to: T + 6 * HOUR, tone: 'alarm' },
    ]);
  });

  it('shades a new monitor as short of data from its creation until its first change, and not before', () => {
    const changes = [aChange('INSUFFICIENT_DATA', 'OK', T + 2 * HOUR)];

    expect(stateBands({ changes, createdAt: T + HOUR, from: T, to: T + 6 * HOUR })).toEqual([{ from: T + HOUR, to: T + 2 * HOUR, tone: 'muted' }]);
  });

  it('shades a window from before the first change as short of data, whatever the monitor is in now', () => {
    // A monitor in alarm now, whose first change came after this window: the history for it is empty.
    expect(stateBands({ changes: [], createdAt: T - HOUR, from: T, to: T + HOUR })).toEqual([{ from: T, to: T + HOUR, tone: 'muted' }]);
  });
});

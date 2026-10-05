import type { MonitorState, MonitorStateChange } from '@mini-cloud/shared';
import type { ChartBand, ChartBandTone } from '@/lib/chart-model';

/** A monitor's history for one window, as the history answers it: with the last change before `from`. */
export interface WindowHistory {
  readonly name: string;
  readonly from: number;
  /** Exclusive. */
  readonly to: number;
  /** In any order. */
  readonly changes: ReadonlyArray<MonitorStateChange>;
}

export interface StateBandsInput {
  /** May be for an earlier window, or another monitor, while the right one loads. */
  readonly history: WindowHistory;
  readonly name: string;
  /** Nothing is shaded before the monitor existed. */
  readonly createdAt: number;
  readonly from: number;
  /** Exclusive. */
  readonly to: number;
}

const TONES: Readonly<Record<MonitorState, ChartBandTone | undefined>> = { ALARM: 'alarm', INSUFFICIENT_DATA: 'muted', OK: undefined };

/** The stretches of a window the monitor spent in alarm or without enough data, as chart bands. */
export function stateBands(input: StateBandsInput): ReadonlyArray<ChartBand> {
  if (input.history.name !== input.name) {
    return [];
  }
  // Only where the history read reaches: outside it the state is not known, and a guess
  // would shade a week as short of data until the week's history arrived.
  const windowFrom = Math.max(input.from, input.history.from);
  const windowTo = Math.min(input.to, input.history.to);
  const ascending = [...input.history.changes].sort((left, right) => left.changedAt - right.changedAt);
  const spans: Array<{ readonly from: number; readonly to: number; readonly state: MonitorState }> = [];
  let start = input.createdAt;
  // Every monitor is created in this state and leaves it only by a recorded change, so with
  // none before `to` it held all window long, whatever the state is now.
  let state: MonitorState = 'INSUFFICIENT_DATA';
  for (const change of ascending) {
    spans.push({ from: start, to: change.changedAt, state });
    start = change.changedAt;
    state = change.toState;
  }
  spans.push({ from: start, to: windowTo, state });

  return spans.flatMap((span): ChartBand[] => {
    const tone = TONES[span.state];
    const from = Math.max(span.from, windowFrom);
    const to = Math.min(span.to, windowTo);
    return tone === undefined || from >= to ? [] : [{ from, to, tone }];
  });
}

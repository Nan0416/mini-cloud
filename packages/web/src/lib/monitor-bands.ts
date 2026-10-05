import type { MonitorState, MonitorStateChange } from '@mini-cloud/shared';
import type { ChartBand, ChartBandTone } from '@/lib/chart-model';

export interface StateBandsInput {
  /** In any order; as the history answers for the window, they include the last change before `from`. */
  readonly changes: ReadonlyArray<MonitorStateChange>;
  /** Nothing is shaded before the monitor existed. */
  readonly createdAt: number;
  readonly from: number;
  /** Exclusive. */
  readonly to: number;
}

const TONES: Readonly<Record<MonitorState, ChartBandTone | undefined>> = { ALARM: 'alarm', INSUFFICIENT_DATA: 'muted', OK: undefined };

/** The stretches of a window the monitor spent in alarm or without enough data, as chart bands. */
export function stateBands(input: StateBandsInput): ReadonlyArray<ChartBand> {
  const ascending = [...input.changes].sort((left, right) => left.changedAt - right.changedAt);
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
  spans.push({ from: start, to: input.to, state });

  return spans.flatMap((span): ChartBand[] => {
    const tone = TONES[span.state];
    const from = Math.max(span.from, input.from);
    const to = Math.min(span.to, input.to);
    return tone === undefined || from >= to ? [] : [{ from, to, tone }];
  });
}

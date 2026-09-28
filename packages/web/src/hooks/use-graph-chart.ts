import { unitForStatistic, type MetricGraph } from '@mini-cloud/shared';
import { useMemo } from 'react';
import type { ChartSeriesState, ChartSeriesView } from '@/components/metrics/time-series-chart';
import { useMetricGraphData, type GraphSeries } from '@/hooks/use-metrics';
import { isRetryable } from '@/lib/errors';
import { frameOf, isDrawableIn, type GraphFrame } from '@/lib/metric-graph-data';
import { colorsOf, labelOf } from '@/lib/metric-graph-editor';

export interface GraphChart {
  readonly series: ReadonlyArray<GraphSeries>;
  readonly chartSeries: ReadonlyArray<ChartSeriesView>;
  /** `undefined` until something has answered. */
  readonly frame: GraphFrame | undefined;
  readonly colors: ReadonlyArray<number>;
  /** Some series is showing an earlier window's data while this one loads. */
  readonly stale: boolean;
}

function stateOf(series: GraphSeries, frame: GraphFrame | undefined): ChartSeriesState {
  // Data first: a poll that fails while the service restarts leaves the last answer in
  // hand, and a series still on screen has not failed as far as a reader is concerned.
  const answered = series.data !== undefined && !series.placeholder;
  if (series.error !== null && !answered) {
    return { kind: 'error', message: series.error.message, retry: isRetryable(series.error) ? series.refetch : undefined };
  }
  // A stand-in read at another period would land on the wrong buckets, so it waits.
  if (series.data === undefined || !isDrawableIn(series, frame)) {
    return { kind: 'loading' };
  }
  return { kind: 'ready', unit: unitForStatistic(series.query.statistic, series.data.unit), datapoints: series.data.datapoints };
}

/** A graph read and shaped for `TimeSeriesChart`: what the metrics page and a dashboard widget both draw. */
export function useGraphChart(graph: MetricGraph): GraphChart {
  const series = useMetricGraphData(graph);
  const colors = useMemo(() => colorsOf(graph.queries), [graph.queries]);
  const frame = useMemo(() => frameOf(series), [series]);
  const chartSeries = useMemo(
    (): ReadonlyArray<ChartSeriesView> =>
      series.map((entry, index) => ({
        id: entry.query.id,
        label: labelOf(entry.query),
        colorSlot: colors[index],
        axis: entry.query.yAxis ?? 'left',
        state: stateOf(entry, frame),
      })),
    [series, colors, frame],
  );
  return { series, chartSeries, frame, colors, stale: series.some((entry) => entry.placeholder) };
}

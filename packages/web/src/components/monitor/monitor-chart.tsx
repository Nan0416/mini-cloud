import { periodOf, type MonitorMetric } from '@mini-cloud/shared';
import { useMemo } from 'react';
import { TimeSeriesChart } from '@/components/metrics/time-series-chart';
import { useGraphChart } from '@/hooks/use-graph-chart';
import type { GraphWindow } from '@/lib/graph-window';
import { monitorGraph } from '@/lib/monitor-editor';

export interface MonitorChartProps {
  readonly metric: MonitorMetric;
  /** Absent draws the series alone, as while a threshold is still being typed. */
  readonly threshold?: number;
  readonly window: GraphWindow;
}

/** The monitored series with its threshold drawn across it. */
export function MonitorChart({ metric, threshold, window }: MonitorChartProps) {
  const graph = useMemo(() => monitorGraph(metric, window), [metric, window]);
  const { chartSeries, frame, stale } = useGraphChart(graph);
  // The one series is on the left, and a threshold is in the metric's own unit, which is the left axis's.
  const thresholds = useMemo(() => (threshold === undefined ? [] : [{ value: threshold, axis: 'left' as const }]), [threshold]);

  return <TimeSeriesChart series={chartSeries} thresholds={thresholds} from={frame?.from ?? 0} to={frame?.to ?? 0} periodMs={frame?.periodMs ?? periodOf(graph)} stale={stale} />;
}

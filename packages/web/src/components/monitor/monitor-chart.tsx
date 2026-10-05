import { periodOf, type Monitor, type MonitorMetric } from '@mini-cloud/shared';
import { useMemo } from 'react';
import { BAND_FILLS, TimeSeriesChart } from '@/components/metrics/time-series-chart';
import { useGraphChart } from '@/hooks/use-graph-chart';
import { useMonitorHistoryBetween } from '@/hooks/use-monitors';
import type { ChartBandTone } from '@/lib/chart-model';
import type { GraphWindow } from '@/lib/graph-window';
import { stateBands } from '@/lib/monitor-bands';
import { monitorGraph } from '@/lib/monitor-editor';

export interface MonitorChartProps {
  readonly metric: MonitorMetric;
  /** Absent draws the series alone, as while a threshold is still being typed. */
  readonly threshold?: number;
  readonly window: GraphWindow;
  /** A saved monitor, whose history is shaded behind the series. */
  readonly monitor?: Monitor;
}

const BAND_LABELS: Readonly<Record<ChartBandTone, string>> = { alarm: 'In alarm', muted: 'Insufficient data' };

/** The monitored series with its threshold drawn across it. */
export function MonitorChart({ metric, threshold, window, monitor }: MonitorChartProps) {
  const graph = useMemo(() => monitorGraph(metric, window), [metric, window]);
  const { chartSeries, frame, stale } = useGraphChart(graph);
  // The one series is on the left, and a threshold is in the metric's own unit, which is the left axis's.
  const thresholds = useMemo(() => (threshold === undefined ? [] : [{ value: threshold, axis: 'left' as const }]), [threshold]);

  const history = useMonitorHistoryBetween(monitor?.name ?? '', monitor === undefined ? undefined : frame);
  const bands = useMemo(
    () =>
      monitor === undefined || frame === undefined || history.data === undefined
        ? []
        : stateBands({ changes: history.data, createdAt: monitor.createdAt, from: frame.from, to: frame.to }),
    [monitor, frame, history.data],
  );
  const tones = new Set(bands.map((band) => band.tone));

  return (
    <div className="space-y-2">
      <TimeSeriesChart
        series={chartSeries}
        thresholds={thresholds}
        bands={bands}
        from={frame?.from ?? 0}
        to={frame?.to ?? 0}
        periodMs={frame?.periodMs ?? periodOf(graph)}
        stale={stale}
      />
      {tones.size === 0 ? null : (
        <ul className="flex gap-4 text-xs text-muted-foreground">
          {(['alarm', 'muted'] as const)
            .filter((tone) => tones.has(tone))
            .map((tone) => (
              <li key={tone} className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-sm" style={{ backgroundColor: BAND_FILLS[tone].color, opacity: BAND_FILLS[tone].opacity * 3 }} />
                {BAND_LABELS[tone]}
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

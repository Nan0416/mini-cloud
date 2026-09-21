import { periodOf, type GetMetricDataResponse, type MetricGraph, type MetricQuery } from '@mini-cloud/shared';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states';
import { AddMetricForm } from '@/components/metrics/add-metric-form';
import { QueryList } from '@/components/metrics/query-list';
import { TimeRangeControls } from '@/components/metrics/time-range-controls';
import { TimeSeriesChart, type ChartSeriesState, type ChartSeriesView } from '@/components/metrics/time-series-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useMetricGraphParam } from '@/hooks/use-metric-graph';
import { useMetricGraphData, useMetricNamespaces, type GraphSeries } from '@/hooks/use-metrics';
import { EMPTY_GRAPH, axisUnitsOf, colorsOf, labelOf, withRange } from '@/lib/metric-graph-editor';
import { urls } from '@/lib/urls';

const DESCRIPTION = 'Published by your programs and by the agents themselves. The graph lives in the address, so a link shows exactly what you see.';

interface Frame {
  readonly from: number;
  readonly to: number;
  readonly periodMs: number;
}

/**
 * The window the chart spans: every current answer's, or while all of them are still
 * loading, the stand-ins'. The two can differ in period, and one grid cannot hold both.
 */
function frameOf(series: ReadonlyArray<GraphSeries>): Frame | undefined {
  const answered = series.flatMap((entry) => (entry.data === undefined ? [] : [{ data: entry.data, placeholder: entry.placeholder }]));
  const current = answered.filter((entry) => !entry.placeholder);
  const chosen: ReadonlyArray<GetMetricDataResponse> = (current.length > 0 ? current : answered).map((entry) => entry.data);
  if (chosen.length === 0) {
    return undefined;
  }
  return {
    from: Math.min(...chosen.map((data) => data.from)),
    to: Math.max(...chosen.map((data) => data.to)),
    periodMs: chosen[0].periodMs,
  };
}

function stateOf(series: GraphSeries): ChartSeriesState {
  if (series.error !== null) {
    return { kind: 'error', message: series.error.message };
  }
  if (series.data === undefined) {
    return { kind: 'loading' };
  }
  return { kind: 'ready', unit: series.data.unit, datapoints: series.data.datapoints };
}

export function MetricsPage() {
  const { graph, error, setGraph } = useMetricGraphParam();
  const namespaces = useMetricNamespaces();

  // A link that cannot be read fetches nothing: the empty graph has no series.
  const shown: MetricGraph = graph ?? EMPTY_GRAPH;
  const series = useMetricGraphData(shown);
  const colors = useMemo(() => colorsOf(shown.queries), [shown.queries]);

  const chartSeries = useMemo(
    (): ReadonlyArray<ChartSeriesView> =>
      series.map((entry, index) => ({ id: entry.query.id, label: labelOf(entry.query), colorSlot: colors[index], axis: entry.query.yAxis ?? 'left', state: stateOf(entry) })),
    [series, colors],
  );
  const frame = frameOf(series);
  // Units as the chart groups them: only a series with data has said what its unit is.
  const units = series.map((entry) => (entry.data !== undefined && entry.data.datapoints.length > 0 ? entry.data.unit : undefined));
  const axisUnits = axisUnitsOf(
    series.flatMap((entry, index) => {
      const unit = units[index];
      return unit === undefined ? [] : [{ axis: entry.query.yAxis ?? 'left', unit }];
    }),
  );

  const update = (next: Partial<MetricGraph>) => setGraph({ ...shown, ...next });
  const replaceQuery = (index: number, query: MetricQuery) => update({ queries: shown.queries.map((candidate, position) => (position === index ? query : candidate)) });

  if (namespaces.isLoading) {
    return <LoadingRows rows={6} />;
  }
  if (namespaces.isError) {
    return <ErrorState error={namespaces.error} onRetry={() => void namespaces.refetch()} />;
  }
  if ((namespaces.data?.namespaces.length ?? 0) === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Metrics" description={DESCRIPTION} />
        <Card>
          <EmptyState
            title="No metrics yet"
            description="Metrics appear a minute or two after a program records one. Import MetricLogger from @mini-cloud/reporter to publish your own, or wait for an agent to report this machine's CPU, memory and disk."
          />
        </Card>
      </div>
    );
  }
  if (graph === undefined) {
    return (
      <div className="space-y-6">
        <PageHeader title="Metrics" description={DESCRIPTION} />
        <Card>
          <EmptyState
            title="This link's graph cannot be read"
            description={error instanceof Error ? error.message : String(error)}
            action={
              <Button asChild variant="outline">
                <Link to={urls.metrics()}>Start a new graph</Link>
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const lone = graph.queries.length === 1 ? series[0] : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title="Metrics" description={DESCRIPTION} />

      <Card>
        <CardHeader>
          <TimeRangeControls
            range={graph.range}
            periodMs={graph.periodMs}
            onRangeChange={(range) => setGraph(withRange(graph, range))}
            onPeriodChange={(periodMs) => update({ periodMs })}
          />
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          {graph.queries.length === 0 ? (
            <EmptyState title="Nothing on this graph yet" description="Add a metric below to plot it." />
          ) : (
            <>
              {/* One series has no legend, so the title names it. */}
              {lone === undefined ? null : (
                <CardTitle className="text-base">
                  {labelOf(lone.query)} {lone.data === undefined ? null : <span className="font-normal text-muted-foreground">({lone.data.unit})</span>}
                </CardTitle>
              )}
              <TimeSeriesChart
                series={chartSeries}
                // Before anything has answered there is no window, and the chart shows its loading or failed state instead.
                from={frame?.from ?? 0}
                to={frame?.to ?? 0}
                periodMs={frame?.periodMs ?? periodOf(graph)}
                stale={series.some((entry) => entry.placeholder)}
              />
              <p className="text-xs text-muted-foreground">Reads stop a few minutes behind now, so every agent has had time to report the newest bucket.</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Series</CardTitle>
          <CardDescription>A series in a second unit goes on the right axis.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-4">
          {graph.queries.length === 0 ? null : (
            <QueryList
              queries={graph.queries}
              colors={colors}
              units={units}
              axisUnits={axisUnits}
              onChange={replaceQuery}
              onRemove={(index) => update({ queries: graph.queries.filter((_, position) => position !== index) })}
            />
          )}
          <AddMetricForm queries={graph.queries} axisUnits={axisUnits} onAdd={(query) => update({ queries: [...graph.queries, query] })} />
        </CardContent>
      </Card>
    </div>
  );
}

import { METRIC_GRAPH_LIMITS, periodOf, unitForStatistic, type MetricGraph, type MetricQuery } from '@mini-cloud/shared';
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
import { useListedUnits, useMetricGraphData, useMetricNamespaces, type GraphSeries } from '@/hooks/use-metrics';
import { isRetryable } from '@/lib/errors';
import { frameOf, isDrawableIn, type GraphFrame } from '@/lib/metric-graph-data';
import { EMPTY_GRAPH, axisUnitsOf, colorsOf, isOnGraph, labelOf, nextColor, nextQueryId, withRange } from '@/lib/metric-graph-editor';
import { urls } from '@/lib/urls';

const DESCRIPTION = 'Published by your programs and by the agents themselves. The graph lives in the address, so a link shows exactly what you see.';

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

/** Adds a query to the graph as it stands, unless it is already there or the graph is full. */
function withQuery(graph: MetricGraph, query: MetricQuery): MetricGraph {
  if (graph.queries.length >= METRIC_GRAPH_LIMITS.queries || isOnGraph(graph.queries, query)) {
    return graph;
  }
  // Given afresh, since the form chose them from the graph as it last rendered.
  return { ...graph, queries: [...graph.queries, { ...query, id: nextQueryId(graph.queries), color: nextColor(graph.queries) }] };
}

export function MetricsPage() {
  const { graph, error, editGraph } = useMetricGraphParam();
  const namespaces = useMetricNamespaces();

  // A link that cannot be read fetches nothing: the empty graph has no series.
  const shown: MetricGraph = graph ?? EMPTY_GRAPH;
  const series = useMetricGraphData(shown);
  const listedUnits = useListedUnits(shown.queries);
  const colors = useMemo(() => colorsOf(shown.queries), [shown.queries]);
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
  // The unit its data reports where it has any, which is what the chart draws; the
  // listing's before then, so a series still loading still holds its axis.
  const units = series.map((entry, index) => {
    const reported = entry.data !== undefined && entry.data.datapoints.length > 0 ? entry.data.unit : listedUnits[index];
    return reported === undefined ? undefined : unitForStatistic(entry.query.statistic, reported);
  });
  const axisUnits = axisUnitsOf(
    series.flatMap((entry, index) => {
      const unit = units[index];
      return unit === undefined ? [] : [{ axis: entry.query.yAxis ?? 'left', unit }];
    }),
  );

  // Only what changed, merged into the row as it stands: a whole row made at the last
  // render would undo an edit made since, such as a label saved a moment ago.
  const changeQuery = (id: string, change: Partial<MetricQuery>) =>
    editGraph((current) => ({ ...current, queries: current.queries.map((candidate) => (candidate.id === id ? { ...candidate, ...change } : candidate)) }));
  const removeQuery = (id: string) => editGraph((current) => ({ ...current, queries: current.queries.filter((candidate) => candidate.id !== id) }));

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
  const loneState = graph.queries.length === 1 ? chartSeries[0].state : undefined;

  return (
    <div className="space-y-6">
      <PageHeader title="Metrics" description={DESCRIPTION} />

      <Card>
        <CardHeader>
          <TimeRangeControls
            range={graph.range}
            periodMs={graph.periodMs}
            onRangeChange={(range) => editGraph((current) => withRange(current, range))}
            onPeriodChange={(periodMs) => editGraph((current) => ({ ...current, periodMs }))}
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
                  {labelOf(lone.query)} {/* Named only for a series the chart is drawing: a stand-in it rejected would have the heading name a unit beside a spinner. */}
                  {loneState?.kind === 'ready' ? <span className="font-normal text-muted-foreground">({loneState.unit})</span> : null}
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
            <QueryList queries={graph.queries} colors={colors} units={units} axisUnits={axisUnits} onChange={changeQuery} onRemove={removeQuery} />
          )}
          <AddMetricForm queries={graph.queries} axisUnits={axisUnits} onAdd={(query) => editGraph((current) => withQuery(current, query))} />
        </CardContent>
      </Card>
    </div>
  );
}

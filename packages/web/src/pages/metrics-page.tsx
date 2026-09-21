import { METRIC_STATISTICS, hashDimensions, type MetricDimensions, type MetricStatistic } from '@mini-cloud/shared';
import { useState } from 'react';
import { PageHeader } from '@/components/common/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states';
import { MetricChart } from '@/components/metrics/metric-chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMetricDimensions, useMetricNames, useMetricNamespaces, useMetricSeries } from '@/hooks/use-metrics';

/** Ranges worth looking at, with a bucket width that gives a readable number of points. */
const RANGES = [
  { label: 'Last hour', spanMs: 3_600_000, periodMs: 60_000 },
  { label: 'Last 6 hours', spanMs: 6 * 3_600_000, periodMs: 300_000 },
  { label: 'Last 24 hours', spanMs: 86_400_000, periodMs: 3_600_000 },
  { label: 'Last 7 days', spanMs: 7 * 86_400_000, periodMs: 3_600_000 },
  { label: 'Last 30 days', spanMs: 30 * 86_400_000, periodMs: 86_400_000 },
] as const;

/** How a dimension set reads in a picker. The empty set is a series too. */
function describeDimensions(dimensions: MetricDimensions): string {
  const entries = Object.entries(dimensions);
  if (entries.length === 0) {
    return 'No dimensions';
  }
  return entries.map(([name, value]) => `${name}=${value}`).join(', ');
}

export function MetricsPage() {
  const [namespace, setNamespace] = useState<string | undefined>(undefined);
  const [metricName, setMetricName] = useState<string | undefined>(undefined);
  const [dimensionsHash, setDimensionsHash] = useState<string | undefined>(undefined);
  const [statistic, setStatistic] = useState<MetricStatistic>('avg');
  const [rangeIndex, setRangeIndex] = useState(0);

  const namespaces = useMetricNamespaces();
  const selectedNamespace = namespace ?? namespaces.data?.namespaces[0];

  const names = useMetricNames(selectedNamespace);
  const selectedMetric = metricName ?? names.data?.metrics[0]?.metricName;

  const dimensions = useMetricDimensions(selectedNamespace, selectedMetric);
  const dimensionSets = dimensions.data?.dimensionSets ?? [];
  const selectedSet = dimensionSets.find((set) => hashDimensions(set) === dimensionsHash) ?? dimensionSets[0];

  const range = RANGES[rangeIndex];

  // Described relatively and resolved to a `from` inside the query function, so the
  // clock is never read while rendering and the cache key stays stable between polls.
  const series = useMetricSeries(
    selectedNamespace === undefined || selectedMetric === undefined || selectedSet === undefined
      ? undefined
      : { namespace: selectedNamespace, metricName: selectedMetric, dimensionsHash: hashDimensions(selectedSet), statistic, spanMs: range.spanMs, periodMs: range.periodMs },
  );

  if (namespaces.isLoading) {
    return <LoadingRows rows={6} />;
  }
  if (namespaces.isError) {
    return <ErrorState error={namespaces.error} onRetry={() => void namespaces.refetch()} />;
  }
  if ((namespaces.data?.namespaces.length ?? 0) === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Metrics" description="Published by your programs and by the agents themselves." />
        <Card>
          <EmptyState
            title="No metrics yet"
            description="Metrics appear a minute or two after a program records one. Import MetricLogger from @mini-cloud/reporter to publish your own, or wait for an agent to report this machine's CPU, memory and disk."
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Metrics" description="Published by your programs and by the agents themselves." />

      <Card>
        <CardHeader className="gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="metric-namespace">Namespace</Label>
              <Select
                value={selectedNamespace ?? ''}
                onValueChange={(value) => {
                  setNamespace(value);
                  // A metric name belongs to its namespace, so both choices below
                  // have to fall back to the new namespace's first option.
                  setMetricName(undefined);
                  setDimensionsHash(undefined);
                }}
              >
                <SelectTrigger id="metric-namespace">
                  <SelectValue placeholder="Choose a namespace" />
                </SelectTrigger>
                <SelectContent>
                  {(namespaces.data?.namespaces ?? []).map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {candidate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="metric-name">Metric</Label>
              <Select
                value={selectedMetric ?? ''}
                onValueChange={(value) => {
                  setMetricName(value);
                  setDimensionsHash(undefined);
                }}
              >
                <SelectTrigger id="metric-name">
                  <SelectValue placeholder="Choose a metric" />
                </SelectTrigger>
                <SelectContent>
                  {(names.data?.metrics ?? []).map((metric) => (
                    <SelectItem key={metric.metricName} value={metric.metricName}>
                      {metric.metricName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="metric-dimensions">Dimensions</Label>
              <Select value={selectedSet === undefined ? '' : hashDimensions(selectedSet)} onValueChange={setDimensionsHash}>
                <SelectTrigger id="metric-dimensions">
                  <SelectValue placeholder="Choose a dimension set" />
                </SelectTrigger>
                <SelectContent>
                  {dimensionSets.map((set) => (
                    <SelectItem key={hashDimensions(set)} value={hashDimensions(set)}>
                      {describeDimensions(set)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="metric-statistic">Statistic</Label>
              <Select value={statistic} onValueChange={(value) => setStatistic(METRIC_STATISTICS.find((candidate) => candidate === value) ?? 'avg')}>
                <SelectTrigger id="metric-statistic">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRIC_STATISTICS.map((candidate) => (
                    <SelectItem key={candidate} value={candidate}>
                      {candidate}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="metric-range">Range</Label>
              <Select value={String(rangeIndex)} onValueChange={(value) => setRangeIndex(Number(value))}>
                <SelectTrigger id="metric-range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGES.map((candidate, index) => (
                    <SelectItem key={candidate.label} value={String(index)}>
                      {candidate.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {selectedMetric === undefined ? (
            <EmptyState title="No metrics in this namespace" />
          ) : series.isLoading ? (
            <LoadingRows rows={5} />
          ) : series.isError ? (
            // Covers the one refusal a reader can act on: a percentile asked for
            // beyond the window where the distribution is kept.
            <ErrorState error={series.error} onRetry={() => void series.refetch()} />
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <CardTitle className="text-base">
                  {selectedMetric} <span className="font-normal text-muted-foreground">({series.data?.unit})</span>
                </CardTitle>
                <CardDescription>
                  {statistic} · {series.data?.resolution} buckets · {describeDimensions(selectedSet ?? {})}
                </CardDescription>
              </div>
              <MetricChart datapoints={series.data?.datapoints ?? []} unit={series.data?.unit ?? 'None'} periodMs={range.periodMs} />
              <p className="text-xs text-muted-foreground">Reads stop a few minutes behind now, so every agent has had time to report the newest bucket.</p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useApi } from '@/hooks/use-connection';
import { queryKeys } from '@/lib/query-keys';
import {
  floorToPeriod,
  hashDimensions,
  parseDimensionsHash,
  periodOf,
  type GetMetricDataRequest,
  type GetMetricDataResponse,
  type MetricGraph,
  type MetricQuery,
  type MetricStatistic,
  type MetricTimeRange,
} from '@mini-cloud/shared';
import { useQueries, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';

/** What a dropdown can usefully show at once. */
const PICKER_PAGE_SIZE = 200;

/**
 * The first page of namespaces.
 *
 * The pickers show one page. A home fleet does not have hundreds of namespaces, and
 * a picker that silently paged would hide the rest just as effectively — better to
 * ask for a known number than to pretend the list is complete.
 */
export function useMetricNamespaces() {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.metricNamespaces(),
    queryFn: () => api.listMetricNamespaces({ limit: PICKER_PAGE_SIZE }),
  });
}

export function useMetricNames(namespace: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.metricNames(namespace ?? ''),
    queryFn: () => api.listMetricNames({ namespace: namespace ?? '', limit: PICKER_PAGE_SIZE }),
    enabled: namespace !== undefined,
  });
}

export function useMetricDimensions(namespace: string | undefined, metricName: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.metricDimensions(namespace ?? '', metricName ?? ''),
    queryFn: () => api.listMetricDimensions({ namespace: namespace ?? '', metricName: metricName ?? '' }),
    enabled: namespace !== undefined && metricName !== undefined,
  });
}

/** What one series is, whatever window it is read over. */
export interface MetricSeriesKey {
  readonly namespace: string;
  readonly metricName: string;
  /** The exact dimension set, as its canonical hash. */
  readonly dimensionsHash: string;
  readonly statistic: MetricStatistic;
}

/**
 * The window a series is read over, as the graph describes it. A relative range stays
 * relative here, so the cache key does not change with the clock and a poll reuses it.
 */
export interface MetricWindowKey {
  readonly range: MetricTimeRange;
  readonly periodMs: number;
}

/** One query of a graph and what reading it has produced so far. */
export interface GraphSeries {
  readonly query: MetricQuery;
  readonly data: GetMetricDataResponse | undefined;
  readonly error: Error | null;
  /** `data` was read for an earlier range or statistic and stands in while this one loads. */
  readonly placeholder: boolean;
}

interface SeriesResult {
  readonly data: GetMetricDataResponse | undefined;
  readonly error: Error | null;
  readonly placeholder: boolean;
}

/** The service holds reads a few minutes behind now, so polling faster would return the same series. */
const POLL_MS = 60_000;

export function seriesKeyOf(query: MetricQuery): MetricSeriesKey {
  return { namespace: query.namespace, metricName: query.metricName, dimensionsHash: hashDimensions(query.dimensions), statistic: query.statistic };
}

/** Resolved when the request is sent, so the clock is never read while rendering. */
function requestFor(series: MetricSeriesKey, window: MetricWindowKey, now: number): GetMetricDataRequest {
  const { range, periodMs } = window;
  const base = { namespace: series.namespace, metricName: series.metricName, statistic: series.statistic, periodMs, dimensions: parseDimensionsHash(series.dimensionsHash) };
  return range.kind === 'relative' ? { ...base, from: floorToPeriod(now - range.durationMs, periodMs) } : { ...base, from: range.from, to: range.to };
}

/** A window wholly in the past has nothing new to show, apart from an agent's late report. */
function isLive(range: MetricTimeRange, now: number): boolean {
  return range.kind === 'relative' || range.to > now;
}

/**
 * The newest data cached for a series over any window, shown dimmed while a new window
 * loads so the chart keeps its frame instead of flashing empty.
 *
 * `keepPreviousData` cannot do this under `useQueries`: its observers are matched by
 * query key, so a series whose range changed gets a new observer with nothing to keep.
 */
function newestCached(client: QueryClient, series: MetricSeriesKey): GetMetricDataResponse | undefined {
  let newest: GetMetricDataResponse | undefined;
  let newestAt = -1;
  for (const [key, data] of client.getQueriesData<GetMetricDataResponse>({ queryKey: queryKeys.metricSeries(series) })) {
    const at = client.getQueryState(key)?.dataUpdatedAt ?? 0;
    if (data !== undefined && at > newestAt) {
      newest = data;
      newestAt = at;
    }
  }
  return newest;
}

/** Module level, so `useQueries` recognises it and recombines only when a result changes. */
function summarise(results: ReadonlyArray<UseQueryResult<GetMetricDataResponse, Error>>): ReadonlyArray<SeriesResult> {
  return results.map((result) => ({ data: result.data, error: result.error, placeholder: result.isPlaceholderData }));
}

/**
 * Every series of a graph, one request each.
 *
 * Separate requests rather than one batch: each is cached on its own, so adding a series
 * does not refetch the others, and each fails on its own, so a percentile refused past
 * raw retention costs that series and not the chart.
 */
export function useMetricGraphData(graph: MetricGraph): ReadonlyArray<GraphSeries> {
  const api = useApi();
  const client = useQueryClient();
  const window: MetricWindowKey = { range: graph.range, periodMs: periodOf(graph) };

  const results = useQueries({
    queries: graph.queries.map((query) => {
      const series = seriesKeyOf(query);
      return {
        queryKey: queryKeys.metricData(series, window),
        queryFn: () => api.getMetricData(requestFor(series, window, Date.now())),
        placeholderData: () => newestCached(client, series),
        refetchInterval: () => (isLive(window.range, Date.now()) ? POLL_MS : false),
      };
    }),
    combine: summarise,
  });

  return useMemo(() => graph.queries.map((query, index) => ({ query, ...results[index] })), [graph.queries, results]);
}

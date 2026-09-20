import { useApi } from '@/hooks/use-connection';
import { queryKeys } from '@/lib/query-keys';
import { floorToPeriod, parseDimensionsHash, type MetricStatistic } from '@mini-cloud/shared';
import { useQuery } from '@tanstack/react-query';

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

/** A series, described by how far back to look rather than by an absolute start. */
export interface MetricSeriesParams {
  readonly namespace: string;
  readonly metricName: string;
  /** The exact dimension set, as its canonical hash. */
  readonly dimensionsHash: string;
  readonly statistic: MetricStatistic;
  readonly spanMs: number;
  readonly periodMs: number;
}

/**
 * A metric series over the last `spanMs`.
 *
 * The window is described relatively and turned into a `from` inside the query
 * function, so the clock is never read while rendering. That also keeps the cache key
 * stable: an absolute start would differ on every render and refetch forever, and the
 * poll below would have nothing to reuse.
 */
export function useMetricSeries(params: MetricSeriesParams | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.metricData(params),
    queryFn: () => {
      if (params === undefined) {
        throw new Error('No metric selected.');
      }
      const from = floorToPeriod(Date.now() - params.spanMs, params.periodMs);
      return api.getMetricData({
        namespace: params.namespace,
        metricName: params.metricName,
        statistic: params.statistic,
        periodMs: params.periodMs,
        from,
        dimensions: parseDimensionsHash(params.dimensionsHash),
      });
    },
    enabled: params !== undefined,
    // The service holds reads a few minutes behind now so every agent has reported,
    // so polling faster than that would return the same series.
    refetchInterval: 60_000,
  });
}

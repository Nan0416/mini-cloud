import type { MetricGraph } from '@mini-cloud/shared';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EMPTY_GRAPH } from '@/lib/metric-graph-editor';
import { GRAPH_PARAM, decodeMetricGraph, encodeMetricGraph } from '@/lib/metric-graph-url';

export interface MetricGraphParam {
  /** The link's graph, the empty one when it has none, or `undefined` when it cannot be read. */
  readonly graph: MetricGraph | undefined;
  /** Why the link's graph cannot be read. */
  readonly error: unknown;
  /** Every edit is its own history entry, so Back undoes it. */
  readonly setGraph: (graph: MetricGraph) => void;
}

interface Decoded {
  readonly graph: MetricGraph | undefined;
  readonly error: unknown;
}

/**
 * The metrics page's state, held in the `graph` query parameter and nowhere else, so
 * reload, Back and a shared link all show the same graph.
 */
export function useMetricGraphParam(): MetricGraphParam {
  const [params, setParams] = useSearchParams();
  const encoded = params.get(GRAPH_PARAM);

  const decoded = useMemo((): Decoded => {
    if (encoded === null) {
      return { graph: EMPTY_GRAPH, error: undefined };
    }
    try {
      return { graph: decodeMetricGraph(encoded), error: undefined };
    } catch (err) {
      return { graph: undefined, error: err };
    }
  }, [encoded]);

  const setGraph = useCallback(
    (graph: MetricGraph) => {
      setParams((current) => {
        const next = new URLSearchParams(current);
        next.set(GRAPH_PARAM, encodeMetricGraph(graph));
        return next;
      });
    },
    [setParams],
  );

  return { graph: decoded.graph, error: decoded.error, setGraph };
}

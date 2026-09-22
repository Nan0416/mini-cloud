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
  /**
   * Applies an edit to the graph as it stands now, not as it stood when the page last
   * rendered. Every edit is its own history entry, so Back undoes it.
   */
  readonly editGraph: (edit: (graph: MetricGraph) => MetricGraph) => void;
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

  const editGraph = useCallback(
    (edit: (graph: MetricGraph) => MetricGraph) => {
      // From the address bar rather than from `params`. React Router hands even a
      // functional update the params of the last render, so a label saved on blur and
      // a click on Add that follows it before a re-render would both start from the same
      // graph, and the label would be lost. `BrowserRouter` writes the address as it
      // navigates, so it always holds the latest edit.
      const current = new URLSearchParams(window.location.search);
      const encodedNow = current.get(GRAPH_PARAM);
      const base = encodedNow === null ? EMPTY_GRAPH : decodeMetricGraph(encodedNow);
      const next = edit(base);
      // An edit with nothing to do leaves history alone, so Back is never a no-op.
      if (next === base) {
        return;
      }
      current.set(GRAPH_PARAM, encodeMetricGraph(next));
      setParams(current);
    },
    [setParams],
  );

  return { graph: decoded.graph, error: decoded.error, editGraph };
}

import type { MetricGraph } from '@mini-cloud/shared';
import { decodeMetricGraph, encodeMetricGraph, nextGraphParam } from '@/lib/metric-graph-url';

const GRAPH: MetricGraph = {
  version: 1,
  queries: [
    { id: 'm1', namespace: 'MiniCloud/Agent', metricName: 'CpuUtilization', dimensions: { AgentId: 'nas' }, statistic: 'avg' },
    { id: 'm2', namespace: 'MiniCloud/Agent', metricName: 'MemoryUsed', dimensions: { AgentId: 'nas' }, statistic: 'max', label: 'Memory', yAxis: 'right' },
  ],
  range: { kind: 'absolute', from: Date.UTC(2026, 8, 1), to: Date.UTC(2026, 8, 2) },
  periodMs: 300_000,
};

function toBase64Url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url');
}

describe('encodeMetricGraph / decodeMetricGraph', () => {
  it('reads back the graph it wrote', () => {
    expect(decodeMetricGraph(encodeMetricGraph(GRAPH))).toEqual(GRAPH);
  });

  it('carries any dimension value, not only Latin-1', () => {
    // `btoa` alone throws on the first character past U+00FF.
    const graph: MetricGraph = { ...GRAPH, queries: [{ ...GRAPH.queries[0], dimensions: { Host: 'café ☕ 東京' } }] };

    expect(decodeMetricGraph(encodeMetricGraph(graph))).toEqual(graph);
  });

  it('writes only characters a URL carries unescaped', () => {
    // Every length of padding, since `=` is the character most likely to be mangled.
    for (const label of ['a', 'ab', 'abc', '>>>???']) {
      const encoded = encodeMetricGraph({ ...GRAPH, queries: [{ ...GRAPH.queries[0], label }] });

      expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('agrees with standard base64url, so a link built elsewhere reads the same', () => {
    expect(encodeMetricGraph(GRAPH)).toBe(toBase64Url(JSON.stringify(GRAPH)));
  });

  it('refuses text that is not base64url', () => {
    expect(() => decodeMetricGraph('not base64!')).toThrow(/not base64url-encoded/);
  });

  it('refuses bytes that are not UTF-8', () => {
    expect(() => decodeMetricGraph(Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url'))).toThrow(/not base64url-encoded/);
  });

  it('refuses text that is not JSON', () => {
    expect(() => decodeMetricGraph(toBase64Url('{"version":'))).toThrow(/not JSON/);
  });

  it('refuses JSON that is not a graph, with the reason the validator gives', () => {
    expect(() => decodeMetricGraph(toBase64Url(JSON.stringify({ ...GRAPH, version: 2 })))).toThrow(/graph.version must be 1/);
  });
});

describe('nextGraphParam', () => {
  const link = encodeMetricGraph(GRAPH);

  it('applies an edit to the graph the link holds', () => {
    const next = nextGraphParam(link, (graph) => ({ ...graph, periodMs: 60_000 }));

    expect(decodeMetricGraph(next ?? '').periodMs).toBe(60_000);
  });

  it('starts a graph from nothing when the link has none', () => {
    const next = nextGraphParam(null, (graph) => ({ ...graph, periodMs: 60_000 }));

    expect(decodeMetricGraph(next ?? '').queries).toEqual([]);
  });

  it('drops an edit that would leave a graph the page could not read back', () => {
    // One metric read two ways. Switching the second row to the first's statistic leaves
    // two rows on one series, which the next read would refuse — and every later edit with it.
    const twoStatistics = encodeMetricGraph({ ...GRAPH, queries: [GRAPH.queries[0], { ...GRAPH.queries[0], id: 'm2', statistic: 'p99' }] });
    const clash = (graph: MetricGraph): MetricGraph => ({ ...graph, queries: graph.queries.map((query) => ({ ...query, statistic: 'avg' as const })) });

    expect(nextGraphParam(twoStatistics, clash)).toBeUndefined();
    expect(nextGraphParam(twoStatistics, (graph) => ({ ...graph, queries: [graph.queries[0]] }))).toBeDefined();
  });

  it('leaves the link alone when an edit changes nothing, so Back is never a no-op', () => {
    expect(nextGraphParam(link, (graph) => graph)).toBeUndefined();
    expect(nextGraphParam(link, (graph) => ({ ...graph, queries: [...graph.queries] }))).toBeUndefined();
  });
});

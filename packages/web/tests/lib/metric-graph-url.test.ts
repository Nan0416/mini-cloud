import type { MetricGraph } from '@mini-cloud/shared';
import { decodeMetricGraph, encodeMetricGraph } from '@/lib/metric-graph-url';

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

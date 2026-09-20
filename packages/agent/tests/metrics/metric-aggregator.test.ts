import { EmfDocument, MetricUnit } from '@mini-cloud/shared';
import { aggregate, mergeData, parseSpoolLines, sealBuckets } from '../../src/metrics/metric-aggregator';

const MINUTE = Date.UTC(2026, 8, 19, 14, 30);
const OPTIONS = { maxHistogramBuckets: 100 };

function aDocument(overrides: { timestamp?: number; dimensions?: Record<string, string>; values?: number | number[]; unit?: MetricUnit; metricName?: string } = {}): EmfDocument {
  const dimensions = overrides.dimensions ?? { Operation: 'Ingest' };
  const name = overrides.metricName ?? 'Latency';
  return {
    ...dimensions,
    [name]: overrides.values ?? 10,
    _aws: {
      Timestamp: overrides.timestamp ?? MINUTE + 15_000,
      CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [Object.keys(dimensions)], Metrics: [{ Name: name, Unit: overrides.unit ?? 'Milliseconds' }] }],
    },
  };
}

describe('parseSpoolLines', () => {
  it('reads back what a logger wrote', () => {
    expect(parseSpoolLines([JSON.stringify(aDocument())])).toHaveLength(1);
  });

  it('skips a line that is not JSON rather than failing the tick', () => {
    // A program killed mid-append can leave anything behind; one bad line must not
    // cost the machine its minute.
    expect(parseSpoolLines(['{"broken', JSON.stringify(aDocument())])).toHaveLength(1);
  });

  it('skips JSON that is not an EMF document', () => {
    expect(parseSpoolLines([JSON.stringify({ hello: 'world' })])).toEqual([]);
  });

  it('ignores blank lines', () => {
    expect(parseSpoolLines(['', '   '])).toEqual([]);
  });
});

describe('aggregate', () => {
  it('folds observations into the minute they fall in', () => {
    const data = aggregate([aDocument({ timestamp: MINUTE + 1_000 }), aDocument({ timestamp: MINUTE + 59_000 })], OPTIONS);

    expect(data).toHaveLength(1);
    expect(data[0].bucketStart).toBe(MINUTE);
    expect(data[0].sampleCount).toBe(2);
  });

  it('splits observations that fall in different minutes', () => {
    const data = aggregate([aDocument({ timestamp: MINUTE + 1_000 }), aDocument({ timestamp: MINUTE + 61_000 })], OPTIONS);

    expect(data.map((datum) => datum.bucketStart).sort()).toEqual([MINUTE, MINUTE + 60_000]);
  });

  it('keeps each dimension set as its own series', () => {
    const data = aggregate([aDocument({ dimensions: { Operation: 'Ingest' } }), aDocument({ dimensions: { Operation: 'Query' } })], OPTIONS);

    expect(data).toHaveLength(2);
  });

  it('computes exact statistics from every observation', () => {
    const data = aggregate([aDocument({ values: [10, 20, 30] })], OPTIONS);

    expect(data[0]).toMatchObject({ sampleCount: 3, sum: 60, min: 10, max: 30 });
  });

  it('keeps the distribution, so a percentile can be answered later', () => {
    const data = aggregate([aDocument({ values: [10, 10, 20] })], OPTIONS);

    expect(data[0].histogram).toEqual({ '10': 2, '20': 1 });
  });

  it('keeps statistics exact even when the distribution had to be rounded', () => {
    // Compaction bounds how many distinct values are stored; it must not change what
    // was counted, summed or seen as the extremes.
    const values = Array.from({ length: 300 }, (_unused, index) => 1000 + index);
    const data = aggregate([aDocument({ values })], { maxHistogramBuckets: 10 });

    expect(data[0].sampleCount).toBe(300);
    expect(data[0].min).toBe(1000);
    expect(data[0].max).toBe(1299);
    expect(Object.keys(data[0].histogram).length).toBeLessThanOrEqual(10);
  });

  it('keeps the first unit when one metric is reported with two, rather than failing', () => {
    // The legacy aggregator threw here, which meant one mislabelled metric discarded
    // the whole batch.
    const data = aggregate([aDocument({ unit: 'Milliseconds' }), aDocument({ unit: 'Seconds' })], OPTIONS);

    expect(data).toHaveLength(1);
    expect(data[0].unit).toBe('Milliseconds');
    expect(data[0].sampleCount).toBe(2);
  });

  it('produces one datum per metric per dimension set per minute', () => {
    const data = aggregate([aDocument({ metricName: 'Latency' }), aDocument({ metricName: 'Calls' })], OPTIONS);

    expect(data.map((datum) => datum.metricName).sort()).toEqual(['Calls', 'Latency']);
  });
});

describe('sealBuckets', () => {
  it('holds back a minute that has not finished', () => {
    // A sealed bucket is never revised, which is what lets a batch be resent under
    // the same id and applied only once.
    const data = aggregate([aDocument({ timestamp: MINUTE + 30_000 })], OPTIONS);

    const { sealed, open } = sealBuckets(data, MINUTE + 40_000);

    expect(sealed).toEqual([]);
    expect(open).toHaveLength(1);
  });

  it('releases a minute once the next one has started', () => {
    const data = aggregate([aDocument({ timestamp: MINUTE + 30_000 })], OPTIONS);

    const { sealed, open } = sealBuckets(data, MINUTE + 60_001);

    expect(sealed).toHaveLength(1);
    expect(open).toEqual([]);
  });

  it('separates the closed minutes from the open one in a mixed batch', () => {
    const data = aggregate([aDocument({ timestamp: MINUTE + 30_000 }), aDocument({ timestamp: MINUTE + 90_000 })], OPTIONS);

    const { sealed, open } = sealBuckets(data, MINUTE + 100_000);

    expect(sealed.map((datum) => datum.bucketStart)).toEqual([MINUTE]);
    expect(open.map((datum) => datum.bucketStart)).toEqual([MINUTE + 60_000]);
  });
});

describe('mergeData', () => {
  it('adds a carried-over bucket to the same bucket read this tick', () => {
    const first = aggregate([aDocument({ timestamp: MINUTE + 10_000, values: 10 })], OPTIONS);
    const second = aggregate([aDocument({ timestamp: MINUTE + 20_000, values: 30 })], OPTIONS);

    const merged = mergeData(first, second);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ sampleCount: 2, sum: 40, min: 10, max: 30 });
  });

  it('keeps different series apart', () => {
    const first = aggregate([aDocument({ dimensions: { Operation: 'Ingest' } })], OPTIONS);
    const second = aggregate([aDocument({ dimensions: { Operation: 'Query' } })], OPTIONS);

    expect(mergeData(first, second)).toHaveLength(2);
  });

  it('gives the same result whichever side a bucket arrives on', () => {
    const first = aggregate([aDocument({ timestamp: MINUTE + 10_000, values: 10 })], OPTIONS);
    const second = aggregate([aDocument({ timestamp: MINUTE + 20_000, values: 30 })], OPTIONS);

    expect(mergeData(first, second)).toEqual(mergeData(second, first));
  });
});

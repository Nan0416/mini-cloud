import { MetricDatum, MetricResolution } from '@mini-cloud/shared';
import {
  DropExpiredPartitionsInput,
  DropExpiredPartitionsOutput,
  EnsurePartitionsInput,
  EnsurePartitionsOutput,
  ListDimensionSetsInput,
  ListDimensionSetsOutput,
  ListMetricsInput,
  ListMetricsOutput,
  ListNamespacesOutput,
  MetricDao,
  PutMetricDataInput,
  PutMetricDataOutput,
  ReadSeriesInput,
  ReadSeriesOutput,
} from '../../src/data/metric-dao';
import { MetricConfig, MetricService } from '../../src/services/metric-service';

const NOW = Date.UTC(2026, 8, 19, 14, 30);
const DAY = 86_400_000;

const CONFIG: MetricConfig = {
  rawRetentionDays: 14,
  rollupRetentionDays: 400,
  queryLagMs: 180_000,
  ingestBatchRetentionMs: DAY,
};

/** Records what it was given, so a test can read back what reached the database. */
class FakeMetricDao implements MetricDao {
  readonly written: PutMetricDataInput[] = [];
  readonly ensured: EnsurePartitionsInput[] = [];
  readonly reads: ReadSeriesInput[] = [];
  duplicate = false;

  async putMetricData(input: PutMetricDataInput): Promise<PutMetricDataOutput> {
    this.written.push(input);
    return { accepted: this.duplicate ? 0 : input.data.length, duplicate: this.duplicate };
  }
  async listNamespaces(): Promise<ListNamespacesOutput> {
    return { namespaces: ['MyApp'] };
  }
  async listMetrics(_input: ListMetricsInput): Promise<ListMetricsOutput> {
    return { metrics: [] };
  }
  async listDimensionSets(_input: ListDimensionSetsInput): Promise<ListDimensionSetsOutput> {
    return { dimensionSets: [] };
  }
  async readSeries(input: ReadSeriesInput): Promise<ReadSeriesOutput> {
    this.reads.push(input);
    return { unit: 'Milliseconds', datapoints: [{ timestamp: input.from, value: 1 }] };
  }
  async ensurePartitions(input: EnsurePartitionsInput): Promise<EnsurePartitionsOutput> {
    this.ensured.push(input);
    return { created: [] };
  }
  async dropExpiredPartitions(_input: DropExpiredPartitionsInput): Promise<DropExpiredPartitionsOutput> {
    return { dropped: [], prunedBatches: 0 };
  }
}

const build = (): { metricDao: FakeMetricDao; service: MetricService } => {
  const metricDao = new FakeMetricDao();
  return { metricDao, service: new MetricService({ metricDao, config: CONFIG }) };
};

const aDatum = (overrides: Partial<MetricDatum> = {}): MetricDatum => ({
  namespace: 'MyApp',
  metricName: 'Latency',
  dimensions: { Operation: 'Ingest' },
  unit: 'Milliseconds',
  bucketStart: NOW - 120_000,
  sampleCount: 1,
  sum: 10,
  min: 10,
  max: 10,
  histogram: { '10': 1 },
  ...overrides,
});

describe('MetricService.putMetricData', () => {
  it('stores data inside the acceptance window', async () => {
    const { metricDao, service } = build();

    const response = await service.putMetricData({ agentId: 'agent-a', batchId: 'b1', data: [aDatum()] }, NOW);

    expect(response).toEqual({ accepted: 1, rejected: [], duplicate: false });
    expect(metricDao.written[0].batchId).toBe('b1');
  });

  it('accepts a bucket from hours ago, because an agent may have been offline', async () => {
    // Late data is the normal case with several machines, not an error: the rollups
    // are updated on write, so a bucket that arrives late still reaches every
    // resolution.
    const { metricDao, service } = build();

    const response = await service.putMetricData({ agentId: 'agent-a', batchId: 'b1', data: [aDatum({ bucketStart: NOW - 6 * 3600_000 })] }, NOW);

    expect(response.accepted).toBe(1);
    expect(metricDao.written[0].data).toHaveLength(1);
  });

  it('rejects a bucket older than retention, naming it, and stores the rest', async () => {
    // One machine with a broken clock must not cost every other machine its minute.
    const { metricDao, service } = build();
    const stale = aDatum({ metricName: 'Ancient', bucketStart: NOW - 20 * DAY });

    const response = await service.putMetricData({ agentId: 'agent-a', batchId: 'b1', data: [stale, aDatum()] }, NOW);

    expect(response.accepted).toBe(1);
    expect(response.rejected).toEqual([{ metricName: 'Ancient', bucketStart: stale.bucketStart, reason: expect.stringContaining('14-day retention window') }]);
    expect(metricDao.written[0].data.map((datum) => datum.metricName)).toEqual(['Latency']);
  });

  it('rejects a bucket more than two hours in the future', async () => {
    const { service } = build();

    const response = await service.putMetricData({ agentId: 'agent-a', batchId: 'b1', data: [aDatum({ bucketStart: NOW + 3 * 3600_000 })] }, NOW);

    expect(response.accepted).toBe(0);
    expect(response.rejected[0].reason).toContain('clock');
  });

  it('accepts a bucket a little ahead, because clocks are never exactly in step', async () => {
    const { service } = build();

    const response = await service.putMetricData({ agentId: 'agent-a', batchId: 'b1', data: [aDatum({ bucketStart: NOW + 60_000 })] }, NOW);

    expect(response.accepted).toBe(1);
  });

  it('creates the partitions the data needs rather than the ones today needs', async () => {
    // An agent back from a week offline must find somewhere for its buckets to land.
    const { metricDao, service } = build();
    const old = NOW - 7 * DAY;

    await service.putMetricData({ agentId: 'agent-a', batchId: 'b1', data: [aDatum({ bucketStart: old })] }, NOW);

    const resolutions = metricDao.ensured[0].buckets.map((bucket) => bucket.resolution);
    expect(resolutions).toEqual(['1m', '1h', '1d']);
    for (const bucket of metricDao.ensured[0].buckets) {
      expect(bucket.bucketStart).toBeLessThanOrEqual(old);
    }
  });

  it('touches nothing when every datum is out of range', async () => {
    const { metricDao, service } = build();

    await service.putMetricData({ agentId: 'agent-a', batchId: 'b1', data: [aDatum({ bucketStart: NOW - 20 * DAY })] }, NOW);

    expect(metricDao.written).toEqual([]);
    expect(metricDao.ensured).toEqual([]);
  });

  it('passes the duplicate verdict back, so an agent can stop retrying', async () => {
    const { metricDao, service } = build();
    metricDao.duplicate = true;

    const response = await service.putMetricData({ agentId: 'agent-a', batchId: 'b1', data: [aDatum()] }, NOW);

    expect(response).toEqual({ accepted: 0, rejected: [], duplicate: true });
  });
});

describe('MetricService.getMetricData', () => {
  const aQuery = (overrides: Record<string, unknown> = {}) => ({
    namespace: 'MyApp',
    metricName: 'Latency',
    statistic: 'avg' as const,
    periodMs: 60_000,
    from: NOW - 3600_000,
    ...overrides,
  });

  it('stops short of now, so a bucket only some agents have reported is not shown', async () => {
    // Otherwise the newest point would dip and then silently correct itself as the
    // rest of the fleet reported the same minute.
    const { metricDao, service } = build();

    await service.getMetricData(aQuery(), NOW);

    expect(metricDao.reads[0].to).toBe(NOW - CONFIG.queryLagMs);
  });

  it('honours an explicit end that is already behind the watermark', async () => {
    const { metricDao, service } = build();

    await service.getMetricData(aQuery({ from: NOW - 7_200_000, to: NOW - 3600_000 }), NOW);

    expect(metricDao.reads[0].to).toBe(NOW - 3600_000);
  });

  it('returns an empty series rather than reading backwards when the range is all too recent', async () => {
    const { metricDao, service } = build();

    const response = await service.getMetricData(aQuery({ from: NOW - 1_000 }), NOW);

    expect(response.datapoints).toEqual([]);
    expect(metricDao.reads).toEqual([]);
  });

  it('reads the coarsest resolution the period lines up with', async () => {
    const { metricDao, service } = build();

    await service.getMetricData(aQuery({ periodMs: 86_400_000 }), NOW);
    await service.getMetricData(aQuery({ periodMs: 3_600_000 }), NOW);
    await service.getMetricData(aQuery({ periodMs: 300_000 }), NOW);

    expect(metricDao.reads.map((read) => read.resolution)).toEqual<MetricResolution[]>(['1d', '1h', '1m']);
  });

  it('reads the minute rows for a percentile, whatever the period', async () => {
    // Only the minute keeps a distribution, and a percentile of percentiles is not a
    // number worth plotting.
    const { metricDao, service } = build();

    await service.getMetricData(aQuery({ statistic: 'p99', periodMs: 3_600_000 }), NOW);

    expect(metricDao.reads[0].resolution).toBe('1m');
  });

  it('refuses a percentile beyond raw retention, and says what to ask for instead', async () => {
    const { service } = build();

    await expect(service.getMetricData(aQuery({ statistic: 'p99', from: NOW - 30 * DAY }), NOW)).rejects.toThrow(/only available for the last 14 days/);
    await expect(service.getMetricData(aQuery({ statistic: 'p99', from: NOW - 30 * DAY }), NOW)).rejects.toThrow(/avg, min, max, sum or count/);
  });

  it('still answers an average over the same long range', async () => {
    const { service } = build();

    await expect(service.getMetricData(aQuery({ statistic: 'avg', periodMs: 86_400_000, from: NOW - 30 * DAY }), NOW)).resolves.toMatchObject({ resolution: '1d' });
  });

  it('rejects a period that is not a whole number of minutes', async () => {
    const { service } = build();

    await expect(service.getMetricData(aQuery({ periodMs: 90_000 }), NOW)).rejects.toThrow(/whole number of minutes/);
  });

  it('aligns the start of the range to the period, so buckets do not straddle', async () => {
    const { metricDao, service } = build();

    await service.getMetricData(aQuery({ periodMs: 300_000, from: NOW - 3600_000 + 12_345 }), NOW);

    expect(metricDao.reads[0].from % 300_000).toBe(0);
  });

  it('defaults to the empty dimension set, which is its own series', async () => {
    const { metricDao, service } = build();

    await service.getMetricData(aQuery(), NOW);

    expect(metricDao.reads[0].dimensionsHash).toBe('_none');
  });

  it('asks for the exact dimension set it was given', async () => {
    const { metricDao, service } = build();

    await service.getMetricData(aQuery({ dimensions: { Operation: 'Ingest' } }), NOW);

    expect(metricDao.reads[0].dimensionsHash).toBe('Operation/Ingest');
  });
});

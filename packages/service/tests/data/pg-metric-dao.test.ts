import { METRIC_DATAPOINT_PAGE_SIZE, MetricDatum } from '@mini-cloud/shared';
import { ReadSeriesInput } from '../../src/data/metric-dao';
import { PgMetricDao } from '../../src/data/pg-metric-dao';
import { fakePool } from './test-helpers';

const MINUTE = Date.UTC(2026, 8, 19, 14, 30);

const aDatum = (overrides: Partial<MetricDatum> = {}): MetricDatum => ({
  namespace: 'MyApp',
  metricName: 'Latency',
  dimensions: { Operation: 'Ingest' },
  unit: 'Milliseconds',
  bucketStart: MINUTE,
  sampleCount: 2,
  sum: 30,
  min: 10,
  max: 20,
  histogram: { '10': 1, '20': 1 },
  ...overrides,
});

/** Ten minutes of one series by the minute. */
const aRead = (overrides: Partial<ReadSeriesInput> = {}): ReadSeriesInput => ({
  namespace: 'MyApp',
  metricName: 'Latency',
  dimensionsHash: '_none',
  resolution: '1m',
  statistic: 'avg',
  periodMs: 60_000,
  from: MINUTE,
  to: MINUTE + 600_000,
  ...overrides,
});

/** Every successful ingest claims the batch id first. */
const claimed = () => fakePool().on('INSERT INTO metric_ingest_batch', { rows: [{ batch_id: 'b1' }], rowCount: 1 });

describe('PgMetricDao.putMetricData', () => {
  it('claims the batch and writes all three resolutions in one transaction', async () => {
    const pool = claimed();

    await new PgMetricDao(pool.asPool()).putMetricData({ batchId: 'b1', agentId: 'agent-a', data: [aDatum()] });

    const inTransaction = pool.queries.filter((query) => query.onClient).map((query) => query.sql.replace(/\s+/g, ' ').trim());
    expect(inTransaction[0]).toBe('BEGIN');
    expect(inTransaction[1]).toContain('INSERT INTO metric_ingest_batch');
    expect(inTransaction.filter((sql) => sql.includes('INSERT INTO metric_datum'))).toHaveLength(3);
    expect(inTransaction[inTransaction.length - 2]).toContain('INSERT INTO metric_series');
    expect(inTransaction[inTransaction.length - 1]).toBe('COMMIT');
    expect(pool.releases).toBe(1);
  });

  it('writes nothing and reports a duplicate when the batch id is already known', async () => {
    // The merge is additive, so applying a resent batch again would double every
    // count in it. The claim is what turns a retry into a no-op.
    const pool = fakePool().on('INSERT INTO metric_ingest_batch', { rows: [], rowCount: 0 });

    const result = await new PgMetricDao(pool.asPool()).putMetricData({ batchId: 'b1', agentId: 'agent-a', data: [aDatum()] });

    expect(result).toEqual({ accepted: 0, duplicate: true });
    expect(pool.statements.some((sql) => sql.includes('INSERT INTO metric_datum'))).toBe(false);
    expect(pool.statements[pool.statements.length - 1]).toBe('COMMIT');
  });

  it('merges rather than replaces, so two agents reporting one bucket both count', async () => {
    const pool = claimed();

    await new PgMetricDao(pool.asPool()).putMetricData({ batchId: 'b1', agentId: 'agent-a', data: [aDatum()] });

    const upsert = pool.queries.filter((query) => query.sql.includes('INSERT INTO metric_datum'))[0].sql.replace(/\s+/g, ' ');
    expect(upsert).toContain('sample_count = metric_datum.sample_count + EXCLUDED.sample_count');
    expect(upsert).toContain('sum_value = metric_datum.sum_value + EXCLUDED.sum_value');
    expect(upsert).toContain('min_value = LEAST(metric_datum.min_value, EXCLUDED.min_value)');
    expect(upsert).toContain('max_value = GREATEST(metric_datum.max_value, EXCLUDED.max_value)');
    expect(upsert).toContain('histogram = metric_histogram_merge(metric_datum.histogram, EXCLUDED.histogram)');
  });

  it('folds several minutes of one series into one row per coarser bucket', async () => {
    // Postgres refuses to let one statement update the same row twice, and sixty
    // minutes of a series all land in one hour, so the fold has to happen first.
    const pool = claimed();
    const data = [aDatum({ bucketStart: MINUTE }), aDatum({ bucketStart: MINUTE + 60_000 }), aDatum({ bucketStart: MINUTE + 120_000 })];

    await new PgMetricDao(pool.asPool()).putMetricData({ batchId: 'b1', agentId: 'agent-a', data });

    const upserts = pool.queries.filter((query) => query.sql.includes('INSERT INTO metric_datum'));
    // Three minutes, but one hour and one day.
    expect((upserts[0].values[1] as unknown[]).length).toBe(3);
    expect((upserts[1].values[1] as unknown[]).length).toBe(1);
    expect((upserts[2].values[1] as unknown[]).length).toBe(1);
  });

  it('adds the folded counts rather than keeping the last one', async () => {
    const pool = claimed();
    const data = [aDatum({ bucketStart: MINUTE, sampleCount: 2, sum: 30, min: 10, max: 20 }), aDatum({ bucketStart: MINUTE + 60_000, sampleCount: 3, sum: 6, min: 1, max: 3 })];

    await new PgMetricDao(pool.asPool()).putMetricData({ batchId: 'b1', agentId: 'agent-a', data });

    const hourly = pool.queries.filter((query) => query.sql.includes('INSERT INTO metric_datum'))[1];
    expect(hourly.values[7]).toEqual([5]);
    expect(hourly.values[8]).toEqual([36]);
    expect(hourly.values[9]).toEqual([1]);
    // The extreme across both minutes, not the last one written.
    expect(hourly.values[10]).toEqual([20]);
  });

  it('keeps a distribution only at the minute', async () => {
    // An hour's percentile derived from sixty minutes' percentiles would not mean
    // anything, so the coarser rows do not pretend to offer one.
    const pool = claimed();

    await new PgMetricDao(pool.asPool()).putMetricData({ batchId: 'b1', agentId: 'agent-a', data: [aDatum()] });

    const upserts = pool.queries.filter((query) => query.sql.includes('INSERT INTO metric_datum'));
    expect(upserts[0].values[0]).toBe('1m');
    expect(upserts[0].values[11]).toEqual([JSON.stringify({ '10': 1, '20': 1 })]);
    expect(upserts[1].values[11]).toEqual([null]);
    expect(upserts[2].values[11]).toEqual([null]);
  });

  it('separates two dimension sets of one metric into two series', async () => {
    const pool = claimed();
    const data = [aDatum({ dimensions: { Operation: 'Ingest' } }), aDatum({ dimensions: { Operation: 'Query' } })];

    await new PgMetricDao(pool.asPool()).putMetricData({ batchId: 'b1', agentId: 'agent-a', data });

    const minutes = pool.queries.filter((query) => query.sql.includes('INSERT INTO metric_datum'))[0];
    expect(new Set(minutes.values[3] as string[]).size).toBe(2);
  });

  it('rolls back, releases the client and rethrows when a statement fails', async () => {
    const pool = claimed().failOn('INSERT INTO metric_series', new Error('unit too long'));

    await expect(new PgMetricDao(pool.asPool()).putMetricData({ batchId: 'b1', agentId: 'agent-a', data: [aDatum()] })).rejects.toThrow('unit too long');

    // Rolling back takes the batch claim with it, so the agent's retry is applied
    // rather than mistaken for a replay of a batch that never landed.
    expect(pool.statements[pool.statements.length - 1]).toBe('ROLLBACK');
    expect(pool.releases).toBe(1);
  });

  it('does not open a transaction for an empty batch', async () => {
    const pool = fakePool();

    const result = await new PgMetricDao(pool.asPool()).putMetricData({ batchId: 'b1', agentId: 'agent-a', data: [] });

    expect(result).toEqual({ accepted: 0, duplicate: false });
    expect(pool.connects).toBe(0);
  });
});

describe('PgMetricDao.listNamespaces', () => {
  const rows = (count: number) => Array.from({ length: count }, (_unused, index) => ({ namespace: `ns-${String(index).padStart(3, '0')}` }));

  it('asks for one more row than the caller wanted', async () => {
    // How a full page is told from the last one, without a second count query.
    const pool = fakePool().on('SELECT DISTINCT namespace', { rows: rows(3) });

    await new PgMetricDao(pool.asPool()).listNamespaces({ limit: 2 });

    expect(pool.find('SELECT DISTINCT namespace').values).toEqual([3, null]);
  });

  it('returns a cursor when there is another page, and trims to the page size', async () => {
    const pool = fakePool().on('SELECT DISTINCT namespace', { rows: rows(3) });

    const result = await new PgMetricDao(pool.asPool()).listNamespaces({ limit: 2 });

    expect(result.namespaces).toEqual(['ns-000', 'ns-001']);
    expect(result.nextCursor).toBe('ns-001');
  });

  it('omits the cursor on the last page', async () => {
    const pool = fakePool().on('SELECT DISTINCT namespace', { rows: rows(2) });

    const result = await new PgMetricDao(pool.asPool()).listNamespaces({ limit: 2 });

    expect(result.namespaces).toEqual(['ns-000', 'ns-001']);
    expect(result.nextCursor).toBeUndefined();
  });

  it('resumes strictly after the cursor', async () => {
    const pool = fakePool().on('SELECT DISTINCT namespace', { rows: [] });

    await new PgMetricDao(pool.asPool()).listNamespaces({ limit: 10, after: 'ns-005' });

    const query = pool.find('SELECT DISTINCT namespace');
    expect(query.sql.replace(/\s+/g, ' ')).toContain('namespace > $2');
    expect(query.values).toEqual([11, 'ns-005']);
  });

  it('caps a limit larger than the maximum', async () => {
    // A DAO called directly must not be able to ask for everything either.
    const pool = fakePool().on('SELECT DISTINCT namespace', { rows: [] });

    await new PgMetricDao(pool.asPool()).listNamespaces({ limit: 99_999 });

    expect(pool.find('SELECT DISTINCT namespace').values[0]).toBe(1001);
  });
});

describe('PgMetricDao.listMetrics', () => {
  const rows = (count: number) => Array.from({ length: count }, (_unused, index) => ({ metric_name: `m-${index}`, unit: 'Milliseconds', last_seen_at: new Date(MINUTE) }));

  it('folds to one row per metric name in SQL, so a page is a page of names', async () => {
    // Folding after the LIMIT would return fewer than asked for whenever a metric
    // had several dimension sets.
    const pool = fakePool().on('ARRAY_AGG', { rows: rows(2) });

    const result = await new PgMetricDao(pool.asPool()).listMetrics({ namespace: 'MyApp', limit: 5 });

    const sql = pool.find('ARRAY_AGG').sql.replace(/\s+/g, ' ');
    expect(sql).toContain('GROUP BY metric_name');
    expect(result.metrics.map((metric) => metric.metricName)).toEqual(['m-0', 'm-1']);
  });

  it('takes the most recently reported unit for a metric whose unit changed', async () => {
    const pool = fakePool().on('ARRAY_AGG', { rows: rows(1) });

    await new PgMetricDao(pool.asPool()).listMetrics({ namespace: 'MyApp' });

    expect(pool.find('ARRAY_AGG').sql.replace(/\s+/g, ' ')).toContain('ARRAY_AGG(unit ORDER BY last_seen_at DESC))[1]');
  });

  it('pages on the metric name, scoped to the namespace', async () => {
    const pool = fakePool().on('ARRAY_AGG', { rows: rows(3) });

    const result = await new PgMetricDao(pool.asPool()).listMetrics({ namespace: 'MyApp', limit: 2, after: 'm-9' });

    expect(pool.find('ARRAY_AGG').values).toEqual(['MyApp', 3, 'm-9']);
    expect(result.nextCursor).toBe('m-1');
  });
});

describe('PgMetricDao.readSeries', () => {
  it('returns nothing for a series that was never written', async () => {
    const pool = fakePool().on('SELECT unit FROM metric_series', { rows: [] });

    const result = await new PgMetricDao(pool.asPool()).readSeries({
      namespace: 'MyApp',
      metricName: 'Latency',
      dimensionsHash: 'Operation/Ingest',
      resolution: '1m',
      statistic: 'avg',
      periodMs: 60_000,
      from: MINUTE,
      to: MINUTE + 600_000,
    });

    expect(result).toEqual({ datapoints: [] });
  });

  it('divides the sum by the sample count for an average', async () => {
    // Not the average of averages: a bucket holding one slow request and a bucket
    // holding a thousand fast ones must not weigh the same.
    const pool = fakePool()
      .on('SELECT unit FROM metric_series', { rows: [{ unit: 'Milliseconds' }] })
      .on('SUM(sample_count)', { rows: [{ bucket_ms: String(MINUTE), sample_count: '4', sum_value: 100, min_value: 5, max_value: 60 }] });

    const result = await new PgMetricDao(pool.asPool()).readSeries({
      namespace: 'MyApp',
      metricName: 'Latency',
      dimensionsHash: 'Operation/Ingest',
      resolution: '1m',
      statistic: 'avg',
      periodMs: 60_000,
      from: MINUTE,
      to: MINUTE + 600_000,
    });

    expect(result).toEqual({ unit: 'Milliseconds', datapoints: [{ timestamp: MINUTE, value: 25 }] });
  });

  it('reads the count as a number, not the string pg returns for int8', async () => {
    const pool = fakePool()
      .on('SELECT unit FROM metric_series', { rows: [{ unit: 'Count' }] })
      .on('SUM(sample_count)', { rows: [{ bucket_ms: String(MINUTE), sample_count: '7', sum_value: 7, min_value: 1, max_value: 1 }] });

    const result = await new PgMetricDao(pool.asPool()).readSeries({
      namespace: 'MyApp',
      metricName: 'Calls',
      dimensionsHash: '_none',
      resolution: '1m',
      statistic: 'count',
      periodMs: 60_000,
      from: MINUTE,
      to: MINUTE + 600_000,
    });

    expect(result.datapoints).toEqual([{ timestamp: MINUTE, value: 7 }]);
  });

  it('computes a percentile from the merged distribution of the buckets in the period', async () => {
    const pool = fakePool()
      .on('SELECT unit FROM metric_series', { rows: [{ unit: 'Milliseconds' }] })
      .on('jsonb_agg(histogram)', {
        rows: [
          {
            bucket_ms: String(MINUTE),
            histograms: [
              { '1': 9, '100': 1 },
              { '1': 90, '100': 10 },
            ],
          },
        ],
      });

    const result = await new PgMetricDao(pool.asPool()).readSeries(aRead({ statistic: 'p90', periodMs: 300_000 }));

    // Both minutes fall in one five-minute bucket, so their distributions merge into
    // one before the percentile is taken.
    expect(result.datapoints).toEqual([{ timestamp: MINUTE, value: 1 }]);
  });

  it('leaves out minutes with no distribution rather than reporting a zero percentile', async () => {
    const pool = fakePool().on('SELECT unit FROM metric_series', { rows: [{ unit: 'Milliseconds' }] });

    await new PgMetricDao(pool.asPool()).readSeries(aRead({ statistic: 'p99' }));

    expect(pool.find('jsonb_agg(histogram)').sql.replace(/\s+/g, ' ')).toContain('AND histogram IS NOT NULL');
  });

  it.each(['avg', 'p99'] as const)('answers one page of %s and a cursor at its last datapoint when more remain', async (statistic) => {
    const fragment = statistic === 'avg' ? 'SUM(sample_count)' : 'jsonb_agg(histogram)';
    const bucket = (index: number) =>
      statistic === 'avg'
        ? { bucket_ms: String(MINUTE + index * 60_000), sample_count: '1', sum_value: 1, min_value: 1, max_value: 1 }
        : { bucket_ms: String(MINUTE + index * 60_000), histograms: [{ '1': 1 }] };
    const pool = fakePool()
      .on('SELECT unit FROM metric_series', { rows: [{ unit: 'Milliseconds' }] })
      .on(fragment, { rows: [bucket(0), bucket(1), bucket(2)] });

    const result = await new PgMetricDao(pool.asPool()).readSeries(aRead({ statistic, limit: 2 }));

    // One row past the page is how the DAO knows there is another.
    expect(pool.find(fragment).values[7]).toBe(3);
    expect(result.datapoints.map((datapoint) => datapoint.timestamp)).toEqual([MINUTE, MINUTE + 60_000]);
    expect(result.nextCursor).toBe(MINUTE + 60_000);
  });

  it('answers no cursor on the last page', async () => {
    const pool = fakePool()
      .on('SELECT unit FROM metric_series', { rows: [{ unit: 'Milliseconds' }] })
      .on('SUM(sample_count)', { rows: [{ bucket_ms: String(MINUTE), sample_count: '1', sum_value: 1, min_value: 1, max_value: 1 }] });

    const result = await new PgMetricDao(pool.asPool()).readSeries(aRead({ limit: 1 }));

    expect(result.datapoints).toHaveLength(1);
    expect(result.nextCursor).toBeUndefined();
  });

  it('starts the next page at the bucket after the cursor, even an unaligned one', async () => {
    const pool = fakePool().on('SELECT unit FROM metric_series', { rows: [{ unit: 'Milliseconds' }] });

    await new PgMetricDao(pool.asPool()).readSeries(aRead({ periodMs: 300_000, after: MINUTE + 12_345 }));

    expect(pool.find('SUM(sample_count)').values[5]).toBe(new Date(MINUTE + 300_000).toISOString());
  });

  it('reads nothing past a cursor at the end of the window', async () => {
    const pool = fakePool().on('SELECT unit FROM metric_series', { rows: [{ unit: 'Milliseconds' }] });

    const result = await new PgMetricDao(pool.asPool()).readSeries(aRead({ after: MINUTE + 540_000 }));

    expect(result).toEqual({ unit: 'Milliseconds', datapoints: [] });
    expect(pool.statements.some((sql) => sql.includes('SUM(sample_count)'))).toBe(false);
  });

  it('holds a page to the largest size, even when a caller asks the DAO directly for more', async () => {
    const pool = fakePool().on('SELECT unit FROM metric_series', { rows: [{ unit: 'Milliseconds' }] });

    await new PgMetricDao(pool.asPool()).readSeries(aRead({ limit: 1_000_000 }));

    expect(pool.find('SUM(sample_count)').values[7]).toBe(METRIC_DATAPOINT_PAGE_SIZE.max + 1);
  });
});

describe('PgMetricDao.ensurePartitions', () => {
  it('creates a leaf for each distinct day, month and year the data needs', async () => {
    const pool = fakePool();

    const { created } = await new PgMetricDao(pool.asPool()).ensurePartitions({
      buckets: [
        { resolution: '1m', bucketStart: MINUTE },
        { resolution: '1h', bucketStart: MINUTE },
        { resolution: '1d', bucketStart: MINUTE },
      ],
    });

    expect(created).toEqual(['metric_datum_1m_20260919', 'metric_datum_1h_202609', 'metric_datum_1d_2026']);
    expect(pool.sql(0)).toContain("PARTITION OF metric_datum_1m FOR VALUES FROM ('2026-09-19T00:00:00.000Z') TO ('2026-09-20T00:00:00.000Z')");
  });

  it('issues the DDL once, however often a partition is asked for', async () => {
    // Otherwise every write would take a DDL lock, on a table every write contends on.
    const pool = fakePool();
    const dao = new PgMetricDao(pool.asPool());

    await dao.ensurePartitions({ buckets: [{ resolution: '1m', bucketStart: MINUTE }] });
    await dao.ensurePartitions({ buckets: [{ resolution: '1m', bucketStart: MINUTE + 60_000 }] });

    expect(pool.statements.filter((sql) => sql.includes('CREATE TABLE'))).toHaveLength(1);
  });

  it('treats another connection having created the partition as success', async () => {
    const duplicate = Object.assign(new Error('relation already exists'), { code: '42P07' });
    const pool = fakePool().failOn('CREATE TABLE', duplicate);

    await expect(new PgMetricDao(pool.asPool()).ensurePartitions({ buckets: [{ resolution: '1m', bucketStart: MINUTE }] })).resolves.toEqual({ created: [] });
  });

  it('still raises a failure that is not a race', async () => {
    const pool = fakePool().failOn('CREATE TABLE', Object.assign(new Error('out of disk'), { code: '53100' }));

    await expect(new PgMetricDao(pool.asPool()).ensurePartitions({ buckets: [{ resolution: '1m', bucketStart: MINUTE }] })).rejects.toThrow('out of disk');
  });
});

describe('PgMetricDao.dropExpiredPartitions', () => {
  it('drops only the leaves that are wholly past their resolution cutoff', async () => {
    // The listing answers with the 1m leaves for every resolution; the ones that do
    // not belong to the resolution being swept are skipped by name, which is also
    // what keeps an unrelated table from ever being dropped.
    const pool = fakePool()
      .on('pg_inherits', { rows: [{ relname: 'metric_datum_1m_20260901' }, { relname: 'metric_datum_1m_20260919' }] })
      .on('DELETE FROM metric_ingest_batch', { rows: [], rowCount: 3 });

    const { dropped, prunedBatches } = await new PgMetricDao(pool.asPool()).dropExpiredPartitions({
      rawCutoff: Date.UTC(2026, 8, 10),
      rollupCutoff: Date.UTC(2020, 0, 1),
      batchCutoff: Date.UTC(2026, 8, 18),
    });

    // Retention is per resolution, which is the whole reason the table is nested by
    // it: a raw day expires while the rollups derived from it stay.
    expect(dropped).toEqual(['metric_datum_1m_20260901']);
    expect(prunedBatches).toBe(3);
    expect(pool.statements).toContain('DROP TABLE IF EXISTS metric_datum_1m_20260901');
  });

  it('leaves a table it cannot read a range from alone', async () => {
    const pool = fakePool()
      .on('pg_inherits', { rows: [{ relname: 'metric_datum_1m_backup' }] })
      .on('DELETE FROM metric_ingest_batch', { rows: [], rowCount: 0 });

    const { dropped } = await new PgMetricDao(pool.asPool()).dropExpiredPartitions({
      rawCutoff: Date.UTC(2030, 0, 1),
      rollupCutoff: Date.UTC(2030, 0, 1),
      batchCutoff: Date.UTC(2030, 0, 1),
    });

    expect(dropped).toEqual([]);
    expect(pool.statements.some((sql) => sql.startsWith('DROP TABLE'))).toBe(false);
  });
});

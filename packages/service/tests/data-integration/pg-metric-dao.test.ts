import { MetricDatum, MetricResolution, floorToResolution } from '@mini-cloud/shared';
import { Pool } from 'pg';
import path from 'node:path';
import { migrate } from '../../src/data/migrate';
import { PgMetricDao } from '../../src/data/pg-metric-dao';
import { createPool } from '../../src/data/pool';

/**
 * Exercises the metric SQL against a real PostgreSQL.
 *
 * This is where the multi-agent properties are pinned down, because they are
 * properties of the statements rather than of the TypeScript around them: that two
 * agents reporting one bucket merge whichever order they arrive in, that a replayed
 * batch changes nothing, that late data still reaches the rollups, and that dropping
 * a partition takes only its own resolution with it. A mocked pool can see the SQL
 * but not what it does.
 *
 * Skipped unless MINI_CLOUD_TEST_DATABASE_URL points at a throwaway database:
 *
 *   docker run -d --name mini-cloud-test-pg -e POSTGRES_USER=minicloud \
 *     -e POSTGRES_PASSWORD=minicloud -e POSTGRES_DB=mini_cloud_test \
 *     -p 55432:5432 postgres:17-alpine
 *   MINI_CLOUD_TEST_DATABASE_URL=postgres://minicloud:minicloud@127.0.0.1:55432/mini_cloud_test npm test
 */
const DATABASE_URL = process.env['MINI_CLOUD_TEST_DATABASE_URL'];
const describeIfDatabase = DATABASE_URL === undefined ? describe.skip : describe;

const MINUTE = Date.UTC(2026, 8, 19, 14, 30);

describeIfDatabase('PgMetricDao', () => {
  let pool: Pool;
  let dao: PgMetricDao;
  let batchSequence = 0;

  const aDatum = (overrides: Partial<MetricDatum> = {}): MetricDatum => ({
    namespace: 'MyApp',
    metricName: 'Latency',
    dimensions: { Operation: 'Ingest' },
    unit: 'Milliseconds',
    bucketStart: MINUTE,
    sampleCount: 1,
    sum: 10,
    min: 10,
    max: 10,
    histogram: { '10': 1 },
    ...overrides,
  });

  /** Writes a batch the way the service does: partitions first, then the data. */
  const report = async (agentId: string, data: ReadonlyArray<MetricDatum>, batchId?: string) => {
    await dao.ensurePartitions({
      buckets: data.flatMap((datum) =>
        (['1m', '1h', '1d'] as MetricResolution[]).map((resolution) => ({ resolution, bucketStart: floorToResolution(datum.bucketStart, resolution) })),
      ),
    });
    return dao.putMetricData({ batchId: batchId ?? `batch-${(batchSequence += 1)}`, agentId, data });
  };

  const rowAt = async (resolution: MetricResolution, bucketStart: number) => {
    const result = await pool.query(
      `SELECT sample_count::int AS sample_count, sum_value, min_value, max_value, histogram
       FROM metric_datum WHERE resolution = $1 AND bucket_start = $2::timestamptz AND metric_name = 'Latency'`,
      [resolution, new Date(bucketStart).toISOString()],
    );
    return result.rows[0];
  };

  beforeAll(async () => {
    pool = createPool({ connectionString: DATABASE_URL ?? '' });
    await migrate(pool, path.resolve(__dirname, '..', '..', 'migrations'));
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Dropping the leaves rather than truncating, so each case starts with no
    // partitions and the cache inside a fresh DAO matches what is really there.
    const leaves = await pool.query<{ relname: string }>(
      `SELECT child.relname FROM pg_inherits
       JOIN pg_class child ON child.oid = pg_inherits.inhrelid
       JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
       WHERE parent.relname IN ('metric_datum_1m', 'metric_datum_1h', 'metric_datum_1d')`,
    );
    for (const row of leaves.rows) {
      await pool.query(`DROP TABLE IF EXISTS ${row.relname}`);
    }
    await pool.query('TRUNCATE metric_series, metric_ingest_batch CASCADE');
    dao = new PgMetricDao(pool);
  });

  it('routes a row into the partition for its resolution and day', async () => {
    await report('agent-a', [aDatum()]);

    const placement = await pool.query<{ table_name: string }>(
      `SELECT tableoid::regclass::text AS table_name FROM metric_datum WHERE resolution = '1m' AND metric_name = 'Latency'`,
    );
    expect(placement.rows[0].table_name).toBe('metric_datum_1m_20260919');
  });

  it('merges two agents reporting the same bucket', async () => {
    await report('agent-a', [aDatum({ sampleCount: 2, sum: 30, min: 10, max: 20, histogram: { '10': 1, '20': 1 } })]);
    await report('agent-b', [aDatum({ sampleCount: 3, sum: 6, min: 1, max: 3, histogram: { '1': 2, '3': 1 } })]);

    const row = await rowAt('1m', MINUTE);
    expect(row.sample_count).toBe(5);
    expect(Number(row.sum_value)).toBe(36);
    expect(Number(row.min_value)).toBe(1);
    expect(Number(row.max_value)).toBe(20);
    expect(row.histogram).toEqual({ '1': 2, '3': 1, '10': 1, '20': 1 });
  });

  it('reaches the same row whichever agent reports first', async () => {
    // This is the property that makes out-of-order reporting across machines a
    // non-event: one agent can post the 14:30 bucket at 14:31 and another at 14:32.
    const first = aDatum({ sampleCount: 2, sum: 30, min: 10, max: 20, histogram: { '10': 1, '20': 1 } });
    const second = aDatum({ sampleCount: 3, sum: 6, min: 1, max: 3, histogram: { '1': 2, '3': 1 } });

    await report('agent-a', [first]);
    await report('agent-b', [second]);
    const forwards = await rowAt('1m', MINUTE);

    await pool.query('DELETE FROM metric_datum');
    await report('agent-b', [second]);
    await report('agent-a', [first]);
    const backwards = await rowAt('1m', MINUTE);

    expect(backwards).toEqual(forwards);
  });

  it('gives the same result as one agent reporting both sets at once', async () => {
    const first = aDatum({ sampleCount: 2, sum: 30, min: 10, max: 20, histogram: { '10': 1, '20': 1 } });
    const second = aDatum({ sampleCount: 3, sum: 6, min: 1, max: 3, histogram: { '1': 2, '3': 1 } });

    await report('agent-a', [first]);
    await report('agent-b', [second]);
    const separately = await rowAt('1m', MINUTE);

    await pool.query('DELETE FROM metric_datum');
    await report('agent-a', [first, second]);
    const together = await rowAt('1m', MINUTE);

    expect(together).toEqual(separately);
  });

  it('applies a replayed batch once, however many times it arrives', async () => {
    // The merge is additive, so without the batch claim a retry would double every
    // count in it.
    await report('agent-a', [aDatum()], 'batch-fixed');
    const afterFirst = await rowAt('1m', MINUTE);

    const replay = await report('agent-a', [aDatum()], 'batch-fixed');

    expect(replay).toEqual({ accepted: 0, duplicate: true });
    expect(await rowAt('1m', MINUTE)).toEqual(afterFirst);
  });

  it('rolls one report into the minute, the hour and the day at once', async () => {
    await report('agent-a', [aDatum({ sampleCount: 2, sum: 30 })]);

    expect((await rowAt('1m', MINUTE)).sample_count).toBe(2);
    expect((await rowAt('1h', floorToResolution(MINUTE, '1h'))).sample_count).toBe(2);
    expect((await rowAt('1d', floorToResolution(MINUTE, '1d'))).sample_count).toBe(2);
  });

  it('adds data that arrives an hour late to the rollups it belongs in', async () => {
    // Rolling up on write rather than on a schedule is what makes this work: a
    // scheduled job would have closed the hour before the straggler arrived.
    const early = MINUTE - 3600_000;
    await report('agent-a', [aDatum({ bucketStart: MINUTE, sampleCount: 1, sum: 10 })]);

    await report('agent-b', [aDatum({ bucketStart: early, sampleCount: 4, sum: 40 })]);

    expect((await rowAt('1h', floorToResolution(early, '1h'))).sample_count).toBe(4);
    expect((await rowAt('1d', floorToResolution(MINUTE, '1d'))).sample_count).toBe(5);
  });

  it('folds several minutes of one series into one hour row in a single batch', async () => {
    // Postgres refuses to update the same row twice in one statement, so this would
    // fail outright if the fold did not happen before the insert.
    const data = Array.from({ length: 5 }, (_unused, index) => aDatum({ bucketStart: MINUTE + index * 60_000 }));

    await report('agent-a', data);

    expect((await rowAt('1h', floorToResolution(MINUTE, '1h'))).sample_count).toBe(5);
  });

  it('keeps a distribution only at the minute', async () => {
    await report('agent-a', [aDatum()]);

    expect((await rowAt('1m', MINUTE)).histogram).toEqual({ '10': 1 });
    expect((await rowAt('1h', floorToResolution(MINUTE, '1h'))).histogram).toBeNull();
  });

  it('leaves the rollups without a distribution even after a second write', async () => {
    // The merge function has to return NULL for two NULLs, or a conflicting write
    // flips an hour row from "no distribution" to an empty object — which is what
    // readers test for before trying to take a percentile from one.
    await report('agent-a', [aDatum()]);
    await report('agent-b', [aDatum()]);

    expect((await rowAt('1h', floorToResolution(MINUTE, '1h'))).histogram).toBeNull();
    expect((await rowAt('1d', floorToResolution(MINUTE, '1d'))).histogram).toBeNull();
    expect((await rowAt('1m', MINUTE)).histogram).toEqual({ '10': 2 });
  });

  it('keeps two dimension sets of one metric as two series', async () => {
    await report('agent-a', [aDatum({ dimensions: { Operation: 'Ingest' } }), aDatum({ dimensions: { Operation: 'Query' } })]);

    const { dimensionSets } = await dao.listDimensionSets({ namespace: 'MyApp', metricName: 'Latency' });
    expect(dimensionSets).toHaveLength(2);
    expect(dimensionSets).toContainEqual({ Operation: 'Ingest' });
  });

  it('reads back an average weighted by how many observations each bucket held', async () => {
    await report('agent-a', [aDatum({ sampleCount: 1, sum: 100, min: 100, max: 100, histogram: { '100': 1 } })]);
    await report('agent-b', [aDatum({ bucketStart: MINUTE + 60_000, sampleCount: 3, sum: 3, min: 1, max: 1, histogram: { '1': 3 } })]);

    const { datapoints } = await dao.readSeries({
      namespace: 'MyApp',
      metricName: 'Latency',
      dimensionsHash: 'Operation/Ingest',
      resolution: '1m',
      statistic: 'avg',
      periodMs: 300_000,
      from: MINUTE,
      to: MINUTE + 300_000,
    });

    // 103 over four observations, not the mean of 100 and 1.
    expect(datapoints).toEqual([{ timestamp: Date.UTC(2026, 8, 19, 14, 30), value: 25.75 }]);
  });

  it('answers a percentile from the merged distribution', async () => {
    await report('agent-a', [aDatum({ histogram: { '1': 9, '100': 1 }, sampleCount: 10, sum: 109, min: 1, max: 100 })]);
    await report('agent-b', [aDatum({ histogram: { '1': 90, '100': 10 }, sampleCount: 100, sum: 1090, min: 1, max: 100 })]);

    const { datapoints } = await dao.readSeries({
      namespace: 'MyApp',
      metricName: 'Latency',
      dimensionsHash: 'Operation/Ingest',
      resolution: '1m',
      statistic: 'p95',
      periodMs: 60_000,
      from: MINUTE,
      to: MINUTE + 60_000,
    });

    expect(datapoints).toEqual([{ timestamp: MINUTE, value: 100 }]);
  });

  it.each(['sum', 'p50'] as const)('walks a sparse %s series across pages without repeating or skipping a bucket', async (statistic) => {
    // Two minutes of each five-minute bucket, and the third bucket empty: the page
    // limit counts buckets, not the minute rows a percentile merges inside them.
    const minutes = [0, 1, 5, 6, 15, 16, 20].map((minute) => MINUTE + minute * 60_000);
    await report(
      'agent-a',
      minutes.map((bucketStart) => aDatum({ bucketStart })),
    );

    const seen: number[] = [];
    let after: number | undefined;
    do {
      const page = await dao.readSeries({
        namespace: 'MyApp',
        metricName: 'Latency',
        dimensionsHash: 'Operation/Ingest',
        resolution: '1m',
        statistic,
        periodMs: 300_000,
        from: MINUTE,
        to: MINUTE + 1_500_000,
        limit: 2,
        after,
      });
      seen.push(...page.datapoints.map((datapoint) => datapoint.timestamp));
      after = page.nextCursor;
    } while (after !== undefined);

    expect(seen).toEqual([0, 5, 15, 20].map((minute) => MINUTE + minute * 60_000));
  });

  it('records what exists, so the pickers never scan the data', async () => {
    await report('agent-a', [aDatum()]);

    expect((await dao.listNamespaces({})).namespaces).toEqual(['MyApp']);
    expect((await dao.listMetrics({ namespace: 'MyApp' })).metrics).toEqual([{ namespace: 'MyApp', metricName: 'Latency', unit: 'Milliseconds', lastSeenAt: expect.any(Number) }]);
  });

  it('walks every namespace across pages without repeating or skipping one', async () => {
    for (const namespace of ['a', 'b', 'c', 'd', 'e']) {
      await report('agent-a', [aDatum({ namespace })]);
    }

    const seen: string[] = [];
    let after: string | undefined;
    do {
      const page = await dao.listNamespaces({ limit: 2, after });
      seen.push(...page.namespaces);
      after = page.nextCursor;
    } while (after !== undefined);

    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('gives a full page of metric names even when each has several dimension sets', async () => {
    // The fold happens in SQL for exactly this reason: folding after the LIMIT would
    // have returned one name here instead of two.
    for (const metricName of ['m1', 'm2', 'm3']) {
      await report('agent-a', [
        aDatum({ metricName, dimensions: { Operation: 'Ingest' } }),
        aDatum({ metricName, dimensions: { Operation: 'Query' } }),
        aDatum({ metricName, dimensions: {} }),
      ]);
    }

    const page = await dao.listMetrics({ namespace: 'MyApp', limit: 2 });

    expect(page.metrics.map((metric) => metric.metricName)).toEqual(['m1', 'm2']);
    expect(page.nextCursor).toBe('m2');
    expect((await dao.listMetrics({ namespace: 'MyApp', limit: 2, after: page.nextCursor })).metrics.map((m) => m.metricName)).toEqual(['m3']);
  });

  it('reports the newest unit for a metric whose unit changed between reports', async () => {
    await report('agent-a', [aDatum({ unit: 'Milliseconds' })]);
    await report('agent-b', [aDatum({ bucketStart: MINUTE + 60_000, unit: 'Seconds' })]);

    expect((await dao.listMetrics({ namespace: 'MyApp' })).metrics[0].unit).toBe('Seconds');
  });

  it('drops a raw day without taking the rollups derived from it', async () => {
    // The whole reason the table is partitioned by resolution first: a fortnight of
    // minutes is worth keeping, a year of daily rollups is, and one DROP must not
    // take both.
    await report('agent-a', [aDatum()]);

    const { dropped } = await dao.dropExpiredPartitions({
      rawCutoff: MINUTE + 30 * 86_400_000,
      rollupCutoff: Date.UTC(2020, 0, 1),
      batchCutoff: Date.UTC(2020, 0, 1),
    });

    expect(dropped).toEqual(['metric_datum_1m_20260919']);
    expect(await rowAt('1m', MINUTE)).toBeUndefined();
    expect((await rowAt('1d', floorToResolution(MINUTE, '1d'))).sample_count).toBe(1);
  });

  it('prunes delivered batch records once no retry could still arrive', async () => {
    await report('agent-a', [aDatum()], 'batch-old');

    const { prunedBatches } = await dao.dropExpiredPartitions({
      rawCutoff: Date.UTC(2020, 0, 1),
      rollupCutoff: Date.UTC(2020, 0, 1),
      batchCutoff: Date.now() + 60_000,
    });

    expect(prunedBatches).toBe(1);
  });

  it('creates a partition for a bucket from a week ago, so a late agent has somewhere to land', async () => {
    const lastWeek = MINUTE - 7 * 86_400_000;

    await report('agent-a', [aDatum({ bucketStart: lastWeek })]);

    expect((await rowAt('1m', lastWeek)).sample_count).toBe(1);
  });
});

describeIfDatabase('migrate', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createPool({ connectionString: DATABASE_URL ?? '' });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('lets only one migrator run at a time', async () => {
    // Two control planes starting together — or two test suites — otherwise race on
    // the same CREATE TABLE and one fails with a duplicate key on a system
    // catalogue, which reads as nothing to do with migrations.
    const migrations = path.resolve(__dirname, '..', '..', 'migrations');

    await expect(Promise.all(Array.from({ length: 4 }, () => migrate(pool, migrations)))).resolves.toBeDefined();
  });

  it('releases the lock, so a later run is not blocked by an earlier one', async () => {
    const migrations = path.resolve(__dirname, '..', '..', 'migrations');
    await migrate(pool, migrations);

    // Nothing left to apply, and — more to the point — it returns at all.
    await expect(migrate(pool, migrations)).resolves.toEqual([]);
  });
});

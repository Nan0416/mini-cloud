import {
  InternalServiceError,
  LoggerFactory,
  METRIC_RESOLUTIONS,
  MetricDatapoint,
  MetricDatum,
  MetricDimensions,
  MetricHistogram,
  MetricResolution,
  MetricStatistic,
  MetricSummary,
  MetricUnit,
  PERCENTILE_STATISTICS,
  floorToPeriod,
  floorToResolution,
  hashDimensions,
  mergeHistograms,
  parseDimensionsHash,
  percentileFrom,
} from '@mini-cloud/shared';
import { Pool, PoolClient } from 'pg';
import {
  DropExpiredPartitionsInput,
  DropExpiredPartitionsOutput,
  EnsurePartitionsInput,
  EnsurePartitionsOutput,
  ListDimensionSetsInput,
  ListDimensionSetsOutput,
  ListMetricsInput,
  ListMetricsOutput,
  ListNamespacesInput,
  ListNamespacesOutput,
  MetricDao,
  PutMetricDataInput,
  PutMetricDataOutput,
  ReadSeriesInput,
  ReadSeriesOutput,
} from './metric-dao';
import { boundLiteral, isExpired, leafBounds, leafName, PARTITION_WIDTH, parentTable, parseLeafName } from '../utils/metric-partitions';
import { toMetricUnit } from './row-parsers';

const logger = LoggerFactory.getLogger('PgMetricDao');

/** Raised by Postgres when two connections create the same partition at once. */
const DUPLICATE_TABLE = '42P07';

interface AggregateRow {
  readonly bucket_ms: string;
  readonly sample_count: string;
  readonly sum_value: number;
  readonly min_value: number;
  readonly max_value: number;
}

interface HistogramRow {
  readonly bucket_start: Date;
  readonly histogram: MetricHistogram | null;
}

interface SeriesRow {
  readonly namespace: string;
  readonly metric_name: string;
  readonly dimensions_hash: string;
  readonly unit: string;
  readonly last_seen_at: Date;
}

/** One series in one bucket, after the batch has been folded down in memory. */
interface MergedDatum {
  readonly namespace: string;
  readonly metricName: string;
  readonly dimensionsHash: string;
  readonly dimensions: MetricDimensions;
  readonly unit: MetricUnit;
  readonly bucketStart: number;
  sampleCount: number;
  sum: number;
  min: number;
  max: number;
  histogram: MetricHistogram;
}

/** JSON rather than a delimiter, so no namespace or metric name can forge a collision. */
function seriesKey(datum: { namespace: string; metricName: string; dimensionsHash: string }): string {
  return JSON.stringify([datum.namespace, datum.metricName, datum.dimensionsHash]);
}

/**
 * Folds a batch down to one row per series per bucket.
 *
 * Done here rather than left to `ON CONFLICT` because Postgres refuses to let one
 * statement update the same row twice — and at the hour and day resolutions that is
 * the normal case, since sixty minutes of one series collapse into one hour.
 */
function mergeByBucket(data: ReadonlyArray<MetricDatum & { dimensionsHash: string }>, resolution: MetricResolution): ReadonlyArray<MergedDatum> {
  const merged = new Map<string, MergedDatum>();

  for (const datum of data) {
    const bucketStart = floorToResolution(datum.bucketStart, resolution);
    const key = `${seriesKey(datum)}:${bucketStart}`;
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        namespace: datum.namespace,
        metricName: datum.metricName,
        dimensionsHash: datum.dimensionsHash,
        dimensions: datum.dimensions,
        unit: datum.unit,
        bucketStart,
        sampleCount: datum.sampleCount,
        sum: datum.sum,
        min: datum.min,
        max: datum.max,
        histogram: datum.histogram,
      });
      continue;
    }
    existing.sampleCount += datum.sampleCount;
    existing.sum += datum.sum;
    existing.min = Math.min(existing.min, datum.min);
    existing.max = Math.max(existing.max, datum.max);
    existing.histogram = mergeHistograms(existing.histogram, datum.histogram);
  }

  return Array.from(merged.values());
}

const UPSERT_DATUM = `
  INSERT INTO metric_datum (namespace, metric_name, dimensions_hash, dimensions, resolution, bucket_start, unit, sample_count, sum_value, min_value, max_value, histogram)
  SELECT ns, name, hash, dims::jsonb, $1::text, bucket::timestamptz, unit, count, total, low, high, hist::jsonb
  FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::bigint[], $9::double precision[], $10::double precision[], $11::double precision[], $12::text[])
    AS batch(ns, name, hash, dims, bucket, unit, count, total, low, high, hist)
  ON CONFLICT (resolution, bucket_start, namespace, metric_name, dimensions_hash) DO UPDATE SET
    sample_count = metric_datum.sample_count + EXCLUDED.sample_count,
    sum_value    = metric_datum.sum_value + EXCLUDED.sum_value,
    min_value    = LEAST(metric_datum.min_value, EXCLUDED.min_value),
    max_value    = GREATEST(metric_datum.max_value, EXCLUDED.max_value),
    histogram    = metric_histogram_merge(metric_datum.histogram, EXCLUDED.histogram),
    updated_at   = now()`;

const UPSERT_SERIES = `
  INSERT INTO metric_series (namespace, metric_name, dimensions_hash, dimensions, unit, last_seen_at)
  SELECT ns, name, hash, dims::jsonb, unit, seen::timestamptz
  FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) AS batch(ns, name, hash, dims, unit, seen)
  ON CONFLICT (namespace, metric_name, dimensions_hash) DO UPDATE SET
    unit         = EXCLUDED.unit,
    last_seen_at = GREATEST(metric_series.last_seen_at, EXCLUDED.last_seen_at)`;

/**
 * Metrics in PostgreSQL.
 *
 * Two things here are load-bearing and worth stating plainly. Writes merge rather than
 * replace, and every merge operator is commutative, so several agents reporting one
 * bucket produce the same row whichever order they arrive in. And the whole batch,
 * including the record of having seen it, commits or does not: that record is what
 * makes a retry a no-op instead of a double count.
 */
export class PgMetricDao implements MetricDao {
  /** Leaves known to exist, so the DDL runs once a day rather than once a write. */
  private readonly knownPartitions = new Set<string>();

  constructor(private readonly pool: Pool) {}

  async putMetricData(input: PutMetricDataInput): Promise<PutMetricDataOutput> {
    const { batchId, agentId, data } = input;
    if (data.length === 0) {
      return { accepted: 0, duplicate: false };
    }

    const withHashes = data.map((datum) => ({ ...datum, dimensionsHash: hashDimensions(datum.dimensions) }));

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // First, so a replay costs one indexed lookup and touches nothing else. The row
      // lands in the same transaction as the data it stands for, so the two can never
      // disagree about whether a batch was applied.
      const claim = await client.query('INSERT INTO metric_ingest_batch (batch_id, agent_id) VALUES ($1, $2) ON CONFLICT (batch_id) DO NOTHING RETURNING batch_id', [
        batchId,
        agentId,
      ]);
      if (claim.rowCount === 0) {
        await client.query('COMMIT');
        logger.info(`Batch ${batchId} from agent ${agentId} was already applied; ignoring the replay.`);
        return { accepted: 0, duplicate: true };
      }

      for (const resolution of METRIC_RESOLUTIONS) {
        await this.upsertResolution(client, resolution, mergeByBucket(withHashes, resolution));
      }
      await this.upsertSeries(client, withHashes);

      await client.query('COMMIT');
      return { accepted: data.length, duplicate: false };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async upsertResolution(client: PoolClient, resolution: MetricResolution, rows: ReadonlyArray<MergedDatum>): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await client.query(UPSERT_DATUM, [
      resolution,
      rows.map((row) => row.namespace),
      rows.map((row) => row.metricName),
      rows.map((row) => row.dimensionsHash),
      rows.map((row) => JSON.stringify(row.dimensions)),
      rows.map((row) => new Date(row.bucketStart).toISOString()),
      rows.map((row) => row.unit),
      rows.map((row) => row.sampleCount),
      rows.map((row) => row.sum),
      rows.map((row) => row.min),
      rows.map((row) => row.max),
      // Only the minute keeps a distribution. An hour's percentile computed from
      // sixty minutes' percentiles would not mean anything, so it is not offered.
      rows.map((row) => (resolution === '1m' ? JSON.stringify(row.histogram) : null)),
    ]);
  }

  private async upsertSeries(client: PoolClient, data: ReadonlyArray<MetricDatum & { dimensionsHash: string }>): Promise<void> {
    const latest = new Map<string, MetricDatum & { dimensionsHash: string }>();
    for (const datum of data) {
      const key = seriesKey(datum);
      const existing = latest.get(key);
      if (existing === undefined || datum.bucketStart > existing.bucketStart) {
        latest.set(key, datum);
      }
    }
    const rows = Array.from(latest.values());

    await client.query(UPSERT_SERIES, [
      rows.map((row) => row.namespace),
      rows.map((row) => row.metricName),
      rows.map((row) => row.dimensionsHash),
      rows.map((row) => JSON.stringify(row.dimensions)),
      rows.map((row) => row.unit),
      rows.map((row) => new Date(row.bucketStart).toISOString()),
    ]);
  }

  async listNamespaces(_input: ListNamespacesInput): Promise<ListNamespacesOutput> {
    const result = await this.pool.query<{ namespace: string }>('SELECT DISTINCT namespace FROM metric_series ORDER BY namespace ASC');
    return { namespaces: result.rows.map((row) => row.namespace) };
  }

  async listMetrics(input: ListMetricsInput): Promise<ListMetricsOutput> {
    const result = await this.pool.query<SeriesRow>(
      `SELECT namespace, metric_name, dimensions_hash, unit, MAX(last_seen_at) AS last_seen_at
       FROM metric_series
       WHERE namespace = $1
       GROUP BY namespace, metric_name, dimensions_hash, unit
       ORDER BY metric_name ASC`,
      [input.namespace],
    );

    // One entry per metric name, not per series: the picker offers metrics, and the
    // dimension sets under one are a separate choice.
    const metrics = new Map<string, MetricSummary>();
    for (const row of result.rows) {
      const existing = metrics.get(row.metric_name);
      const lastSeenAt = row.last_seen_at.getTime();
      if (existing === undefined || lastSeenAt > existing.lastSeenAt) {
        metrics.set(row.metric_name, { namespace: row.namespace, metricName: row.metric_name, unit: toMetricUnit(row.unit), lastSeenAt });
      }
    }
    return { metrics: Array.from(metrics.values()) };
  }

  async listDimensionSets(input: ListDimensionSetsInput): Promise<ListDimensionSetsOutput> {
    const result = await this.pool.query<{ dimensions_hash: string }>(
      'SELECT dimensions_hash FROM metric_series WHERE namespace = $1 AND metric_name = $2 ORDER BY dimensions_hash ASC',
      [input.namespace, input.metricName],
    );
    return { dimensionSets: result.rows.map((row) => parseDimensionsHash(row.dimensions_hash)) };
  }

  async readSeries(input: ReadSeriesInput): Promise<ReadSeriesOutput> {
    const unit = await this.readUnit(input.namespace, input.metricName, input.dimensionsHash);
    if (unit === undefined) {
      return { datapoints: [] };
    }

    const isPercentile = PERCENTILE_STATISTICS.some((statistic) => statistic === input.statistic);
    const datapoints = isPercentile ? await this.readPercentile(input) : await this.readAggregate(input);
    return { unit, datapoints };
  }

  private async readUnit(namespace: string, metricName: string, dimensionsHash: string): Promise<MetricUnit | undefined> {
    const result = await this.pool.query<{ unit: string }>('SELECT unit FROM metric_series WHERE namespace = $1 AND metric_name = $2 AND dimensions_hash = $3', [
      namespace,
      metricName,
      dimensionsHash,
    ]);
    if (result.rows.length === 0) {
      return undefined;
    }
    return toMetricUnit(result.rows[0].unit);
  }

  private async readAggregate(input: ReadSeriesInput): Promise<ReadonlyArray<MetricDatapoint>> {
    const result = await this.pool.query<AggregateRow>(
      `SELECT (FLOOR(EXTRACT(EPOCH FROM bucket_start) * 1000 / $5) * $5)::bigint AS bucket_ms,
              SUM(sample_count) AS sample_count,
              SUM(sum_value)    AS sum_value,
              MIN(min_value)    AS min_value,
              MAX(max_value)    AS max_value
       FROM metric_datum
       WHERE namespace = $1 AND metric_name = $2 AND dimensions_hash = $3 AND resolution = $4
         AND bucket_start >= $6::timestamptz AND bucket_start < $7::timestamptz
       GROUP BY bucket_ms
       ORDER BY bucket_ms ASC`,
      [input.namespace, input.metricName, input.dimensionsHash, input.resolution, input.periodMs, new Date(input.from).toISOString(), new Date(input.to).toISOString()],
    );

    return result.rows.map((row) => ({ timestamp: Number(row.bucket_ms), value: project(input.statistic, row) }));
  }

  /**
   * Percentiles need the distribution, so the minute rows are read and their
   * histograms merged per requested bucket.
   *
   * Merging the distributions and taking one percentile is not the same as averaging
   * sixty percentiles, and only the first is a number worth plotting.
   */
  private async readPercentile(input: ReadSeriesInput): Promise<ReadonlyArray<MetricDatapoint>> {
    const result = await this.pool.query<HistogramRow>(
      `SELECT bucket_start, histogram
       FROM metric_datum
       WHERE namespace = $1 AND metric_name = $2 AND dimensions_hash = $3 AND resolution = $4
         AND bucket_start >= $5::timestamptz AND bucket_start < $6::timestamptz
       ORDER BY bucket_start ASC`,
      [input.namespace, input.metricName, input.dimensionsHash, input.resolution, new Date(input.from).toISOString(), new Date(input.to).toISOString()],
    );

    const buckets = new Map<number, MetricHistogram>();
    for (const row of result.rows) {
      if (row.histogram === null) {
        continue;
      }
      const bucket = floorToPeriod(row.bucket_start.getTime(), input.periodMs);
      buckets.set(bucket, mergeHistograms(buckets.get(bucket) ?? {}, row.histogram));
    }

    const percentile = Number(input.statistic.slice(1)) / 100;
    return Array.from(buckets.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([timestamp, histogram]) => ({ timestamp, value: percentileFrom(histogram, percentile) }));
  }

  async ensurePartitions(input: EnsurePartitionsInput): Promise<EnsurePartitionsOutput> {
    const wanted = new Map<string, { resolution: MetricResolution; bucketStart: number }>();
    for (const bucket of input.buckets) {
      const name = leafName(bucket.resolution, bucket.bucketStart);
      if (!this.knownPartitions.has(name)) {
        wanted.set(name, bucket);
      }
    }

    const created: string[] = [];
    for (const [name, bucket] of wanted) {
      const bounds = leafBounds(bucket.bucketStart, PARTITION_WIDTH[bucket.resolution]);
      // Neither the name nor the bounds can carry user input: both are generated from
      // a resolution and a number, so there is nothing to parameterise even if DDL
      // allowed it.
      const statement = `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF ${parentTable(bucket.resolution)} FOR VALUES FROM ('${boundLiteral(bounds.from)}') TO ('${boundLiteral(bounds.to)}')`;
      try {
        await this.pool.query(statement);
        created.push(name);
      } catch (err) {
        // Two connections creating the same partition is expected, not a failure.
        if (!isDuplicateTable(err)) {
          throw err;
        }
      }
      this.knownPartitions.add(name);
    }

    if (created.length > 0) {
      logger.info(`Created metric partitions: ${created.join(', ')}.`);
    }
    return { created };
  }

  async dropExpiredPartitions(input: DropExpiredPartitionsInput): Promise<DropExpiredPartitionsOutput> {
    const dropped: string[] = [];

    for (const resolution of METRIC_RESOLUTIONS) {
      const cutoff = resolution === '1m' ? input.rawCutoff : input.rollupCutoff;
      const result = await this.pool.query<{ relname: string }>(
        // `relkind` matters: pg_inherits lists partitioned *indexes* under the same
        // parent, and those must never reach a DROP TABLE. The name check below would
        // also reject them, but not relying on that keeps the intent in the query.
        `SELECT child.relname
         FROM pg_inherits
         JOIN pg_class child  ON child.oid  = pg_inherits.inhrelid
         JOIN pg_class parent ON parent.oid = pg_inherits.inhparent
         WHERE parent.relname = $1 AND child.relkind IN ('r', 'p')`,
        [parentTable(resolution)],
      );

      for (const row of result.rows) {
        const bounds = parseLeafName(resolution, row.relname);
        if (bounds === undefined || !isExpired(bounds, cutoff)) {
          continue;
        }
        // Dropping the partition is the whole point of nesting by resolution: the
        // alternative is a DELETE across millions of rows and the vacuum that follows.
        await this.pool.query(`DROP TABLE IF EXISTS ${row.relname}`);
        this.knownPartitions.delete(row.relname);
        dropped.push(row.relname);
      }
    }

    const pruned = await this.pool.query('DELETE FROM metric_ingest_batch WHERE accepted_at < $1::timestamptz', [new Date(input.batchCutoff).toISOString()]);

    if (dropped.length > 0) {
      logger.info(`Retention dropped metric partitions: ${dropped.join(', ')}.`);
    }
    return { dropped, prunedBatches: pruned.rowCount ?? 0 };
  }
}

/** Reads the statistic a caller asked for out of one aggregated row. */
function project(statistic: MetricStatistic, row: AggregateRow): number {
  const sampleCount = Number(row.sample_count);
  switch (statistic) {
    case 'sum':
      return row.sum_value;
    case 'count':
      return sampleCount;
    case 'min':
      return row.min_value;
    case 'max':
      return row.max_value;
    case 'avg':
      return sampleCount === 0 ? 0 : row.sum_value / sampleCount;
    default:
      // Percentiles never reach here; they are read from the distribution instead.
      throw new InternalServiceError(`Statistic ${statistic} cannot be projected from an aggregate row.`);
  }
}

function isDuplicateTable(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === DUPLICATE_TABLE;
}

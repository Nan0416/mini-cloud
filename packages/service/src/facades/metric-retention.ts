import { LoggerFactory, METRIC_RESOLUTIONS, floorToResolution } from '@mini-cloud/shared';
import { MetricDao } from '../data/metric-dao';
import { MetricConfig } from '../services/metric-service';

const logger = LoggerFactory.getLogger('MetricRetention');

const DAY_MS = 86_400_000;

export interface MetricRetentionProps {
  readonly metricDao: MetricDao;
  readonly config: MetricConfig;
  /** How often to sweep. Hourly is ample for something measured in days. */
  readonly tickMs: number;
}

/**
 * Keeps the metric partitions swept: creates the ones about to be needed, drops the
 * ones nothing will read again.
 *
 * Creating ahead is not strictly required — ingest creates whatever a batch needs —
 * but doing it here means the first write of a new day is not also the write that
 * takes a DDL lock.
 */
export class MetricRetention {
  private readonly props: MetricRetentionProps;
  private timer?: NodeJS.Timeout;

  // A slow sweep must not overlap the next one: two concurrent sweeps would race to
  // drop the same partition, and the loser would fail on a table that no longer exists.
  private running = false;

  constructor(props: MetricRetentionProps) {
    this.props = props;
  }

  start(): void {
    const { config, tickMs } = this.props;
    logger.info(`Starting metric retention: raw ${config.rawRetentionDays} days, rollups ${config.rollupRetentionDays} days, sweeping every ${tickMs}ms.`);
    // Once at startup, so a service that was down over a boundary catches up rather
    // than waiting a full tick with no partition for today.
    void this.runTick();
    this.timer = setInterval(() => void this.runTick(), tickMs);
  }

  stop(): void {
    if (this.timer !== undefined) {
      logger.info('Stopping metric retention.');
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runTick(now: number = Date.now()): Promise<void> {
    if (this.running) {
      logger.warn('Skipping a metric retention sweep: the previous one is still running.');
      return;
    }
    this.running = true;

    const { metricDao, config } = this.props;
    try {
      // Today and tomorrow, at every resolution, so a write never waits on DDL.
      await metricDao.ensurePartitions({
        buckets: METRIC_RESOLUTIONS.flatMap((resolution) => [
          { resolution, bucketStart: floorToResolution(now, resolution) },
          { resolution, bucketStart: floorToResolution(now + DAY_MS, resolution) },
        ]),
      });

      const { dropped, prunedBatches } = await metricDao.dropExpiredPartitions({
        rawCutoff: now - config.rawRetentionDays * DAY_MS,
        rollupCutoff: now - config.rollupRetentionDays * DAY_MS,
        batchCutoff: now - config.ingestBatchRetentionMs,
      });

      if (dropped.length > 0 || prunedBatches > 0) {
        logger.info(`Metric retention dropped ${dropped.length} partition(s) and pruned ${prunedBatches} delivered batch record(s).`);
      }
    } catch (err) {
      // Logged and swallowed: a failed sweep costs disk, and the next tick retries the
      // same window. Letting it escape would take the timer, and the service, down.
      logger.error('Metric retention sweep failed; it will be retried on the next tick.', err);
    } finally {
      this.running = false;
    }
  }
}

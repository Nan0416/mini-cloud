import { LoggerFactory, MetricDatum, PutMetricDataRequest } from '@mini-cloud/shared';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HostMetrics } from './host-metrics';
import { aggregate, mergeData, parseSpoolLines, sealBuckets } from './metric-aggregator';
import { SpoolReader } from './spool-reader';

const logger = LoggerFactory.getLogger('MetricsCollector');

/** What the collector needs to deliver a batch. Narrower than the whole client. */
export interface MetricPublisher {
  putMetricData(request: PutMetricDataRequest): Promise<unknown>;
}

export interface MetricsCollectorProps {
  readonly agentId: string;
  readonly reader: SpoolReader;
  readonly publisher: MetricPublisher;
  readonly pendingDir: string;
  readonly maxHistogramBuckets: number;
  readonly hostMetrics?: HostMetrics;
  /** Generates a batch id. Injected so a test can make one predictable. */
  readonly newBatchId: () => string;
}

interface PendingBatch {
  readonly batchId: string;
  readonly data: ReadonlyArray<MetricDatum>;
}

/**
 * Drains the spool once a tick and delivers what it finds.
 *
 * Three things make this safe to run on several machines at once, all of which
 * matter because agents report into shared series with no ordering between them:
 *
 * - Only *sealed* minutes are sent. A bucket whose minute has not finished is carried
 *   to the next tick, so a batch's contents are fixed once written.
 * - A batch is written to disk **before** it is posted, and the spool offset advances
 *   at the same time. A failed post therefore resends the identical batch rather than
 *   re-reading the spool and building an overlapping one.
 * - The batch id goes with it, so the service recognises a resend and applies it once.
 */
export class MetricsCollector {
  private readonly props: MetricsCollectorProps;

  /** Buckets read but not yet closed, waiting for their minute to end. */
  private carried: ReadonlyArray<MetricDatum> = [];

  constructor(props: MetricsCollectorProps) {
    this.props = props;
  }

  async collect(now: number = Date.now()): Promise<void> {
    // Anything left from a previous tick goes first, so a backlog drains in order.
    await this.deliverPending();

    const documents = [...parseSpoolLines((await this.readSpool(now)).lines)];
    if (this.props.hostMetrics !== undefined) {
      documents.push(...(await this.props.hostMetrics.sample(now)));
    }

    const options = { maxHistogramBuckets: this.props.maxHistogramBuckets };
    const fresh = aggregate(documents, options);
    const { sealed, open } = sealBuckets(mergeData(this.carried, fresh, options), now);
    this.carried = open;

    if (sealed.length === 0) {
      return;
    }

    const batch: PendingBatch = { batchId: this.props.newBatchId(), data: sealed };
    await this.writePending(batch);
    await this.deliver(batch);
  }

  /** Reads the spool and commits the new offsets, retiring files past their hour. */
  private async readSpool(now: number): Promise<{ lines: ReadonlyArray<string> }> {
    const { reader } = this.props;
    const batch = await reader.read();
    // The tick's clock, not the wall clock: retiring a file on a different notion of
    // time than the one that decided which buckets are sealed would drop a file whose
    // data this tick had not finished with.
    const kept = await reader.retire(batch.offsets, now);
    // Saved now, not after the post: the data is about to be written to a pending
    // batch, which is what makes it durable.
    await reader.saveOffsets(kept);
    return { lines: batch.lines };
  }

  private async writePending(batch: PendingBatch): Promise<void> {
    try {
      await mkdir(this.props.pendingDir, { recursive: true });
      await writeFile(path.join(this.props.pendingDir, `${batch.batchId}.json`), JSON.stringify(batch), { encoding: 'utf-8' });
    } catch (err) {
      // The batch is still delivered from memory; only the retry guarantee is lost.
      logger.warn(`Could not persist metric batch ${batch.batchId}; it will be delivered but not retried if that fails.`, err);
    }
  }

  private async deliver(batch: PendingBatch): Promise<void> {
    try {
      await this.props.publisher.putMetricData({ agentId: this.props.agentId, batchId: batch.batchId, data: batch.data });
      await this.discardPending(batch.batchId);
      logger.debug(`Reported ${batch.data.length} metric datum(s) in batch ${batch.batchId}.`);
    } catch (err) {
      // Left on disk for the next tick. Resending the same id is safe: the service
      // applies a batch once, however many times it arrives.
      logger.warn(`Could not deliver metric batch ${batch.batchId}; it will be retried.`, err);
    }
  }

  private async deliverPending(): Promise<void> {
    for (const batch of await this.loadPending()) {
      await this.deliver(batch);
    }
  }

  private async loadPending(): Promise<ReadonlyArray<PendingBatch>> {
    let files: string[];
    try {
      files = (await readdir(this.props.pendingDir, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name);
    } catch {
      return [];
    }

    const batches: PendingBatch[] = [];
    for (const file of files.sort()) {
      const full = path.join(this.props.pendingDir, file);
      try {
        const parsed: unknown = JSON.parse(await readFile(full, { encoding: 'utf-8' }));
        if (isPendingBatch(parsed)) {
          batches.push(parsed);
          continue;
        }
        logger.warn(`Discarding the unreadable pending metric batch ${file}: it is not a batch.`);
        await rm(full, { force: true });
      } catch (err) {
        // Also discarded, for the same reason: a file that will not parse will not
        // parse on the next tick either, and leaving it re-reads and re-logs it
        // every minute for as long as the agent runs.
        logger.warn(`Discarding the unreadable pending metric batch ${file}: ${err instanceof Error ? err.message : String(err)}`);
        await rm(full, { force: true }).catch(() => undefined);
      }
    }
    return batches;
  }

  private async discardPending(batchId: string): Promise<void> {
    try {
      await rm(path.join(this.props.pendingDir, `${batchId}.json`), { force: true });
    } catch (err) {
      // A stale file costs one duplicate delivery, which the service ignores.
      logger.debug(`Could not remove the delivered metric batch ${batchId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function isPendingBatch(value: unknown): value is PendingBatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record: Record<string, unknown> = { ...value };
  return typeof record['batchId'] === 'string' && Array.isArray(record['data']);
}

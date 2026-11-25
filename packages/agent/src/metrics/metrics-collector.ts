import {
  ForbiddenError,
  InternalServiceError,
  InvalidRequestError,
  LoggerFactory,
  MAX_REQUEST_BODY_BYTES,
  METRIC_RESOLUTION_MS,
  MetricDatum,
  PayloadTooLargeError,
  PutMetricDataRequest,
  ServiceUnreachableError,
  UnauthenticatedError,
  floorToResolution,
} from '@mini-cloud/shared';
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
  /** Waits between delivery attempts. Injected so a test need not. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Waits before each retry of a minute's batch, after a first attempt that failed.
 *
 * Two retries 5s apart still land well inside the service's query lag, so a brief
 * failure, such as a restart or a deadlock with another agent's batch, does not leave
 * the minute short when it is first graphed and judged.
 */
export const DELIVERY_RETRY_DELAYS_MS: ReadonlyArray<number> = [5_000, 5_000];

/**
 * How far into each minute the collector runs, at the earliest.
 *
 * The reporter writes a closed minute to the spool a second after it ends, so this
 * leaves it room; and every agent sending a minute within a known few seconds is what
 * lets the service know when that minute's data is in.
 */
export const COLLECT_OFFSET_MS = 5_000;

/** The spread past the offset, so a fleet's batches do not all contend for the same rows at once. */
export const COLLECT_JITTER_MS = 5_000;

/**
 * Milliseconds from `now` until the next collect, `jitterMs` past the offset.
 *
 * Counted from the offset rather than from the jittered moment, so a collect at :09
 * followed by a jitter of 1s waits for the next minute instead of running again at :06.
 */
export function msUntilNextCollect(now: number, jitterMs: number): number {
  const minute = METRIC_RESOLUTION_MS['1m'];
  return floorToResolution(now - COLLECT_OFFSET_MS, '1m') + minute + COLLECT_OFFSET_MS + jitterMs - now;
}

/**
 * The most one batch's data may come to, serialized, before the rest goes in another.
 *
 * Half the service's body limit, leaving the envelope plenty of room. Without a cap, an
 * agent that was down for days sends the whole backlog as one batch the service can
 * only refuse.
 */
export const MAX_BATCH_BYTES = MAX_REQUEST_BODY_BYTES / 2;

/**
 * Cuts `data` into runs whose JSON comes to at most `maxBytes`, keeping the order. A
 * datum over the limit on its own still goes, alone, rather than being dropped here.
 */
export function splitByBytes(data: ReadonlyArray<MetricDatum>, maxBytes: number): ReadonlyArray<ReadonlyArray<MetricDatum>> {
  const runs: MetricDatum[][] = [];
  let run: MetricDatum[] = [];
  let runBytes = 2; // the brackets
  for (const datum of data) {
    const bytes = Buffer.byteLength(JSON.stringify(datum));
    // Plus the comma that would separate it from the run so far.
    if (run.length > 0 && runBytes + 1 + bytes > maxBytes) {
      runs.push(run);
      run = [];
      runBytes = 2;
    }
    runBytes += (run.length > 0 ? 1 : 0) + bytes;
    run.push(datum);
  }
  if (run.length > 0) {
    runs.push(run);
  }
  return runs;
}

interface PendingBatch {
  readonly batchId: string;
  readonly data: ReadonlyArray<MetricDatum>;
}

/**
 * How one delivery ended. `kept` leaves the batch for the next tick; `stop` does too,
 * and also ends this tick's pass, because the reason applies to every batch behind it.
 */
type DeliveryOutcome = 'delivered' | 'discarded' | 'kept' | 'stop';

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

    // All on disk before any is posted, so a pass that stops early leaves the rest for
    // the next tick rather than losing them.
    const batches: PendingBatch[] = splitByBytes(sealed, MAX_BATCH_BYTES).map((data) => ({ batchId: this.props.newBatchId(), data }));
    for (const batch of batches) {
      await this.writePending(batch);
    }
    for (const batch of batches) {
      if ((await this.deliver(batch, DELIVERY_RETRY_DELAYS_MS)) === 'stop') {
        return;
      }
    }
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

  /** Whether the batch is on disk, and so will survive a failed post. */
  private async writePending(batch: PendingBatch): Promise<boolean> {
    try {
      await mkdir(this.props.pendingDir, { recursive: true });
      await writeFile(path.join(this.props.pendingDir, `${batch.batchId}.json`), JSON.stringify(batch), { encoding: 'utf-8' });
      return true;
    } catch (err) {
      // The batch is still delivered from memory; only the retry guarantee is lost.
      logger.warn(`Could not persist metric batch ${batch.batchId}; it will be delivered but not retried if that fails.`, err);
      return false;
    }
  }

  /**
   * Resending the same id is safe: the service applies a batch once, however many
   * times it arrives. What happens after a failure depends on whether sending it again
   * could ever succeed:
   *
   * - too large: halved, and the halves sent instead;
   * - invalid: discarded, since the same bytes would be refused forever;
   * - anything else: kept for the next tick, after `retryDelaysMs` quick retries when
   *   the service was unreachable or failed.
   */
  private async deliver(batch: PendingBatch, retryDelaysMs: ReadonlyArray<number>): Promise<DeliveryOutcome> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.props.publisher.putMetricData({ agentId: this.props.agentId, batchId: batch.batchId, data: batch.data });
        await this.discardPending(batch.batchId);
        logger.debug(`Reported ${batch.data.length} metric datum(s) in batch ${batch.batchId}.`);
        return 'delivered';
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          return this.split(batch, retryDelaysMs);
        }
        if (err instanceof InvalidRequestError) {
          logger.error(`Discarding metric batch ${batch.batchId} (${describe(batch)}): the service refused it, and would refuse it again. ${err.message}`);
          await this.discardPending(batch.batchId);
          return 'discarded';
        }
        const delayMs = retryDelaysMs[attempt];
        if (delayMs !== undefined && isTransient(err)) {
          logger.info(`Could not deliver metric batch ${batch.batchId}; retrying in ${delayMs}ms. ${err instanceof Error ? err.message : String(err)}`);
          await (this.props.sleep ?? sleep)(delayMs);
          continue;
        }
        // Left on disk for the next tick.
        logger.warn(`Could not deliver metric batch ${batch.batchId}; it will be retried next minute.`, err);
        return stopsThePass(err) ? 'stop' : 'kept';
      }
    }
  }

  /**
   * A batch refused as too large was never read, let alone applied, so its data can go
   * again under new ids. Halving rather than cutting to a size the agent believes in
   * converges whatever the service's limit turns out to be.
   *
   * The halves are on disk before the original is removed, and their ids derive from
   * its id, so a crash in between rewrites the same two files instead of sending any
   * datum twice.
   */
  private async split(batch: PendingBatch, retryDelaysMs: ReadonlyArray<number>): Promise<DeliveryOutcome> {
    if (batch.data.length < 2) {
      logger.error(`Discarding metric batch ${batch.batchId} (${describe(batch)}): one datum on its own is over the service's size limit.`);
      await this.discardPending(batch.batchId);
      return 'discarded';
    }
    const middle = Math.ceil(batch.data.length / 2);
    const halves: PendingBatch[] = [batch.data.slice(0, middle), batch.data.slice(middle)].map((data, index) => ({ batchId: `${batch.batchId}.${index}`, data }));
    logger.info(`Metric batch ${batch.batchId} (${describe(batch)}) is over the service's size limit; sending it as ${halves[0].batchId} and ${halves[1].batchId}.`);

    for (const half of halves) {
      if (!(await this.writePending(half))) {
        // Without the halves on disk, removing the original could lose the data.
        return 'kept';
      }
    }
    await this.discardPending(batch.batchId);

    let outcome: DeliveryOutcome = 'delivered';
    for (const half of halves) {
      const result = await this.deliver(half, retryDelaysMs);
      if (result === 'stop') {
        return 'stop';
      }
      if (result === 'kept') {
        outcome = 'kept';
      }
    }
    return outcome;
  }

  /**
   * One attempt each: these have had their retries, and a long backlog must not hold up
   * this minute's batch. The pass ends at the first failure that would fail every batch
   * the same way, so a week's backlog against an unreachable service costs one timeout
   * a tick rather than one per batch.
   */
  private async deliverPending(): Promise<void> {
    for (const batch of await this.loadPending()) {
      if ((await this.deliver(batch, [])) === 'stop') {
        return;
      }
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

/** Worth a quick retry within the tick: the service was down or failed, and may not be in five seconds. */
function isTransient(err: unknown): boolean {
  return err instanceof ServiceUnreachableError || err instanceof InternalServiceError;
}

/**
 * Fails every batch alike, so the rest of a pass would only repeat it. A 5xx is not
 * here: it can be one batch's doing, and stopping on it would let that batch block
 * everything behind it.
 */
function stopsThePass(err: unknown): boolean {
  return err instanceof ServiceUnreachableError || err instanceof UnauthenticatedError || err instanceof ForbiddenError;
}

/** For a log line about a batch: how much it holds, and which minutes. */
function describe(batch: PendingBatch): string {
  // A loop, not `Math.min(...starts)`: a week's backlog is more arguments than a call can take.
  let first = Infinity;
  let last = -Infinity;
  for (const datum of batch.data) {
    first = Math.min(first, datum.bucketStart);
    last = Math.max(last, datum.bucketStart);
  }
  const range = batch.data.length === 0 ? 'no minutes' : `${new Date(first).toISOString()} to ${new Date(last).toISOString()}`;
  return `${batch.data.length} datum(s), ${range}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPendingBatch(value: unknown): value is PendingBatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record: Record<string, unknown> = { ...value };
  return typeof record['batchId'] === 'string' && Array.isArray(record['data']);
}

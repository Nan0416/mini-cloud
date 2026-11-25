import {
  EmfDocument,
  ForbiddenError,
  InternalServiceError,
  InvalidRequestError,
  MetricDatum,
  MetricUnit,
  PayloadTooLargeError,
  PutMetricDataRequest,
  ServiceUnreachableError,
  UnauthenticatedError,
} from '@mini-cloud/shared';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  COLLECT_JITTER_MS,
  COLLECT_OFFSET_MS,
  DELIVERY_RETRY_DELAYS_MS,
  MAX_BATCH_BYTES,
  MetricPublisher,
  MetricsCollector,
  msUntilNextCollect,
  splitByBytes,
} from '../../src/metrics/metrics-collector';
import { SpoolReader } from '../../src/metrics/spool-reader';

const HOUR = Date.UTC(2026, 8, 19, 14);
const MINUTE = HOUR + 30 * 60_000;
const SPOOL_FILE = 'inst-1-2026-09-19-14.emf';

/**
 * Records the batches it was given, and can be told to fail. Applies each batch id once,
 * as the service does, so `applied` is what the service would have stored.
 */
class FakePublisher implements MetricPublisher {
  readonly sent: PutMetricDataRequest[] = [];
  readonly applied = new Map<string, ReadonlyArray<MetricDatum>>();
  failures = 0;
  failWith: Error = new Error('service unreachable');
  /** Refuses as too large any batch holding more than this, as the service does by bytes. */
  maxData = Infinity;
  /** Runs before the answer, for a test that needs the disk to change mid-delivery. */
  beforeAnswer?: (request: PutMetricDataRequest) => Promise<void>;

  async putMetricData(request: PutMetricDataRequest): Promise<unknown> {
    this.sent.push(request);
    await this.beforeAnswer?.(request);
    if (request.data.length > this.maxData) {
      throw new PayloadTooLargeError('The request body is too large.');
    }
    if (this.failures > 0) {
      this.failures -= 1;
      throw this.failWith;
    }
    if (!this.applied.has(request.batchId)) {
      this.applied.set(request.batchId, request.data);
    }
    return {};
  }

  /** Every minute stored, once per time it was stored. */
  appliedMinutes(): number[] {
    return [...this.applied.values()].flatMap((data) => data.map((datum) => (datum.bucketStart - HOUR) / 60_000)).sort((a, b) => a - b);
  }
}

function aDocument(timestamp: number, value = 10, unit: MetricUnit = 'Milliseconds'): EmfDocument {
  return {
    Operation: 'Ingest',
    Latency: value,
    _aws: { Timestamp: timestamp, CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [['Operation']], Metrics: [{ Name: 'Latency', Unit: unit }] }] },
  };
}

/** One sealed minute's datum for an operation; `minute` counts from `HOUR`. */
function aDatum(minute: number, operation = 'Ingest'): MetricDatum {
  return {
    namespace: 'MyApp',
    metricName: 'Latency',
    dimensions: { Operation: operation },
    unit: 'Milliseconds',
    bucketStart: HOUR + minute * 60_000,
    sampleCount: 1,
    sum: 1,
    min: 1,
    max: 1,
    histogram: { '1': 1 },
  };
}

describe('MetricsCollector', () => {
  let dir: string;
  let publisher: FakePublisher;
  let collector: MetricsCollector;
  let nextId = 0;
  let waits: number[];

  const spoolDir = (): string => path.join(dir, 'spool');
  const pendingDir = (): string => path.join(dir, 'pending');
  const write = async (...documents: EmfDocument[]): Promise<void> => {
    await writeFile(path.join(spoolDir(), SPOOL_FILE), documents.map((document) => `${JSON.stringify(document)}\n`).join(''));
  };
  /** A batch a previous tick left on disk, holding `count` minutes. */
  const leavePending = async (batchId: string, count: number, firstMinute = 0): Promise<void> => {
    await mkdir(pendingDir(), { recursive: true });
    const data = Array.from({ length: count }, (_, index) => aDatum(firstMinute + index));
    await writeFile(path.join(pendingDir(), `${batchId}.json`), JSON.stringify({ batchId, data }));
  };
  /** Many operations in one minute, which aggregate to as many datums. */
  const writeOperations = async (count: number): Promise<void> => {
    await write(...Array.from({ length: count }, (_, index) => ({ ...aDocument(MINUTE + 10_000), Operation: `operation-${index}` })));
  };
  const pendingFiles = (): string[] => readdirSync(pendingDir()).sort();

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mini-cloud-collector-'));
    await mkdir(spoolDir(), { recursive: true });
    publisher = new FakePublisher();
    nextId = 0;
    waits = [];
    collector = new MetricsCollector({
      agentId: 'agent-a',
      reader: new SpoolReader({ spoolDir: spoolDir(), offsetsPath: path.join(dir, 'offsets.json') }),
      publisher,
      pendingDir: pendingDir(),
      maxHistogramBuckets: 100,
      newBatchId: () => `batch-${(nextId += 1)}`,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports the minutes it found', async () => {
    await write(aDocument(MINUTE + 10_000), aDocument(MINUTE + 20_000, 30));

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent).toHaveLength(1);
    expect(publisher.sent[0]).toMatchObject({ agentId: 'agent-a', batchId: 'batch-1' });
    expect(publisher.sent[0].data[0]).toMatchObject({ bucketStart: MINUTE, sampleCount: 2, sum: 40, min: 10, max: 30 });
  });

  it('sends nothing when the spool is empty', async () => {
    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent).toEqual([]);
  });

  it('holds back a minute that has not finished, and sends it on a later tick', async () => {
    // A sealed bucket is never revised, which is what makes a batch safe to resend.
    await write(aDocument(MINUTE + 10_000));

    await collector.collect(MINUTE + 30_000);
    expect(publisher.sent).toEqual([]);

    await collector.collect(MINUTE + 61_000);
    expect(publisher.sent).toHaveLength(1);
    expect(publisher.sent[0].data[0].bucketStart).toBe(MINUTE);
  });

  it('adds what a later tick reads to the bucket it was still holding', async () => {
    await write(aDocument(MINUTE + 10_000, 10));
    await collector.collect(MINUTE + 30_000);

    await writeFile(path.join(spoolDir(), SPOOL_FILE), `${JSON.stringify(aDocument(MINUTE + 10_000, 10))}\n${JSON.stringify(aDocument(MINUTE + 40_000, 30))}\n`);
    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent[0].data[0]).toMatchObject({ sampleCount: 2, sum: 40 });
  });

  it('writes the batch to disk before posting it', async () => {
    // The spool offset advances at the same time, so a failed post cannot be
    // recovered by re-reading the spool — only by resending this file.
    publisher.failures = 1;
    await write(aDocument(MINUTE + 10_000));

    await collector.collect(MINUTE + 61_000);

    expect(readdirSync(pendingDir())).toEqual(['batch-1.json']);
  });

  it('resends the identical batch under the identical id after a failure', async () => {
    // A different id, or a batch that had grown, would be added on top of the write
    // that actually succeeded on the service.
    publisher.failures = 1;
    await write(aDocument(MINUTE + 10_000));

    await collector.collect(MINUTE + 61_000);
    await collector.collect(MINUTE + 121_000);

    expect(publisher.sent).toHaveLength(2);
    expect(publisher.sent[1].batchId).toBe(publisher.sent[0].batchId);
    expect(publisher.sent[1].data).toEqual(publisher.sent[0].data);
  });

  it('does not re-read the spool into the retry, however much arrived since', async () => {
    publisher.failures = 1;
    await write(aDocument(MINUTE + 10_000));
    await collector.collect(MINUTE + 61_000);

    await writeFile(path.join(spoolDir(), SPOOL_FILE), `${JSON.stringify(aDocument(MINUTE + 10_000))}\n${JSON.stringify(aDocument(MINUTE + 70_000))}\n`);
    await collector.collect(MINUTE + 121_000);

    const retried = publisher.sent[1];
    expect(retried.batchId).toBe('batch-1');
    expect(retried.data).toHaveLength(1);
    expect(retried.data[0].bucketStart).toBe(MINUTE);
  });

  it('stops retrying once a batch is delivered', async () => {
    publisher.failures = 1;
    await write(aDocument(MINUTE + 10_000));

    await collector.collect(MINUTE + 61_000);
    await collector.collect(MINUTE + 121_000);
    await collector.collect(MINUTE + 181_000);

    expect(publisher.sent).toHaveLength(2);
    expect(readdirSync(pendingDir())).toEqual([]);
  });

  it('keeps no pending file for a batch that went straight through', async () => {
    await write(aDocument(MINUTE + 10_000));

    await collector.collect(MINUTE + 61_000);

    expect(readdirSync(pendingDir())).toEqual([]);
  });

  it('delivers a backlog left by a previous run before anything new', async () => {
    await mkdir(pendingDir(), { recursive: true });
    await writeFile(
      path.join(pendingDir(), 'batch-0.json'),
      JSON.stringify({
        batchId: 'batch-0',
        data: [
          { namespace: 'MyApp', metricName: 'Latency', dimensions: {}, unit: 'Milliseconds', bucketStart: HOUR, sampleCount: 1, sum: 1, min: 1, max: 1, histogram: { '1': 1 } },
        ],
      }),
    );
    await write(aDocument(MINUTE + 10_000));

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent.map((request) => request.batchId)).toEqual(['batch-0', 'batch-1']);
  });

  it('retries a batch the service could not take twice, 5s apart, within the same tick', async () => {
    await write(aDocument(MINUTE + 10_000));
    publisher.failWith = new ServiceUnreachableError('connection refused');
    publisher.failures = 2;

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent.map((request) => request.batchId)).toEqual(['batch-1', 'batch-1', 'batch-1']);
    expect(waits).toEqual(DELIVERY_RETRY_DELAYS_MS);
    expect(readdirSync(pendingDir())).toEqual([]);
  });

  it('leaves a batch for the next tick once its retries are spent', async () => {
    await write(aDocument(MINUTE + 10_000));
    publisher.failWith = new ServiceUnreachableError('connection refused');
    publisher.failures = 3;

    await collector.collect(MINUTE + 61_000);
    expect(publisher.sent).toHaveLength(3);
    expect(readdirSync(pendingDir())).toEqual(['batch-1.json']);

    await collector.collect(MINUTE + 121_000);
    expect(publisher.sent.map((request) => request.batchId)).toEqual(['batch-1', 'batch-1', 'batch-1', 'batch-1']);
    expect(readdirSync(pendingDir())).toEqual([]);
  });

  it('discards a batch the service refused as invalid, which it would refuse forever', async () => {
    await write(aDocument(MINUTE + 10_000));
    publisher.failWith = new InvalidRequestError('bad batch');
    publisher.failures = 1;

    await collector.collect(MINUTE + 61_000);
    await collector.collect(MINUTE + 121_000);

    expect(publisher.sent).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(pendingFiles()).toEqual([]);
  });

  it('sends a large minute as several batches, each under the size limit', async () => {
    await writeOperations(1_200);

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent.length).toBeGreaterThan(1);
    for (const request of publisher.sent) {
      expect(Buffer.byteLength(JSON.stringify(request.data))).toBeLessThanOrEqual(MAX_BATCH_BYTES);
    }
    expect(publisher.sent.flatMap((request) => request.data)).toHaveLength(1_200);
    expect(new Set(publisher.sent.map((request) => request.batchId)).size).toBe(publisher.sent.length);
  });

  it('leaves the rest of a large minute on disk when the service cannot be reached', async () => {
    await writeOperations(1_200);
    publisher.failWith = new ServiceUnreachableError('connection refused');
    publisher.failures = 99;

    await collector.collect(MINUTE + 61_000);

    // The first batch had its retries; the rest were not each made to wait out the same timeout.
    expect(publisher.sent.map((request) => request.batchId)).toEqual(['batch-1', 'batch-1', 'batch-1']);
    expect(pendingFiles().length).toBeGreaterThan(1);
  });

  it('gives the rest of a large minute one attempt each once a batch has spent its retries on a failing service', async () => {
    await writeOperations(1_200);
    publisher.failWith = new InternalServiceError('Internal server error (HTTP 500)');
    publisher.failures = 99;

    await collector.collect(MINUTE + 61_000);

    const batches = new Set(publisher.sent.map((request) => request.batchId)).size;
    expect(batches).toBeGreaterThan(1);
    expect(publisher.sent).toHaveLength(DELIVERY_RETRY_DELAYS_MS.length + batches);
    expect(waits).toEqual(DELIVERY_RETRY_DELAYS_MS);
    expect(pendingFiles()).toHaveLength(batches);
  });

  it('still tries a batch it could not save after the pass stops, since nothing would send it later', async () => {
    await writeOperations(1_200);
    // A file where the pending directory belongs makes every save fail.
    await writeFile(pendingDir(), '');
    publisher.failWith = new ServiceUnreachableError('connection refused');
    publisher.failures = 99;

    await collector.collect(MINUTE + 61_000);

    const ids = publisher.sent.map((request) => request.batchId);
    const batches = new Set(ids).size;
    expect(batches).toBeGreaterThan(1);
    expect(ids.filter((id) => id === 'batch-1')).toHaveLength(DELIVERY_RETRY_DELAYS_MS.length + 1);
    expect(ids).toHaveLength(DELIVERY_RETRY_DELAYS_MS.length + batches);
  });

  it('halves a batch the service refuses as too large, and sends the halves in its place', async () => {
    await leavePending('batch-0', 4);
    publisher.maxData = 2;

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent.map((request) => [request.batchId, request.data.length])).toEqual([
      ['batch-0', 4],
      ['batch-0.0', 2],
      ['batch-0.1', 2],
    ]);
    expect(pendingFiles()).toEqual([]);
  });

  it('keeps halving until the pieces fit, delivering every datum once', async () => {
    await leavePending('batch-0', 4);
    publisher.maxData = 1;

    await collector.collect(MINUTE + 61_000);

    expect([...publisher.applied.keys()]).toEqual(['batch-0.0.0', 'batch-0.0.1', 'batch-0.1.0', 'batch-0.1.1']);
    expect(publisher.appliedMinutes()).toEqual([0, 1, 2, 3]);
    expect(pendingFiles()).toEqual([]);
  });

  it('keeps both halves on disk, and not the original, when the service goes away mid-split', async () => {
    await leavePending('batch-0', 4);
    publisher.maxData = 2;
    publisher.failWith = new ServiceUnreachableError('connection refused');
    publisher.failures = 1;

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent.map((request) => request.batchId)).toEqual(['batch-0', 'batch-0.0']);
    expect(pendingFiles()).toEqual(['batch-0.0.json', 'batch-0.1.json']);
  });

  it('finishes a split a crash interrupted without storing any datum twice, however long the service remembers ids', async () => {
    // The parent and both halves on disk: the agent stopped after writing the halves and
    // before removing the parent. Sending the halves and then splitting the parent again
    // would send each half twice.
    await leavePending('batch-0', 4);
    await leavePending('batch-0.0', 2);
    await leavePending('batch-0.1', 2, 2);
    publisher.maxData = 2;

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent.map((request) => request.batchId)).toEqual(['batch-0', 'batch-0.0', 'batch-0.1']);
    expect(publisher.appliedMinutes()).toEqual([0, 1, 2, 3]);
    expect(pendingFiles()).toEqual([]);
  });

  it('sends no half while the batch it was cut from is still on disk, even when removing that batch fails', async () => {
    await leavePending('batch-0', 4);
    const parent = path.join(pendingDir(), 'batch-0.json');
    const contents = await readFile(parent, 'utf-8');
    publisher.maxData = 2;
    // A non-empty directory in the parent's place: writing the halves still works, removing the parent does not.
    publisher.beforeAnswer = async (request) => {
      if (request.batchId === 'batch-0') {
        await rm(parent);
        await mkdir(parent);
        await writeFile(path.join(parent, 'keep'), '');
      }
    };

    await collector.collect(MINUTE + 61_000);
    expect(publisher.sent.map((request) => request.batchId)).toEqual(['batch-0']);
    expect(pendingFiles()).toEqual(['batch-0.0.json', 'batch-0.1.json', 'batch-0.json']);

    // As the failed removal would have left it: the parent still a file beside its halves.
    publisher.beforeAnswer = undefined;
    await rm(parent, { recursive: true });
    await writeFile(parent, contents);
    await collector.collect(MINUTE + 121_000);

    expect(publisher.appliedMinutes()).toEqual([0, 1, 2, 3]);
    expect(pendingFiles()).toEqual([]);
  });

  it('keeps a batch it could not split onto disk, rather than removing it with nothing to replace it', async () => {
    await leavePending('batch-0', 4);
    // A directory where the first half would go makes that write fail.
    await mkdir(path.join(pendingDir(), 'batch-0.0.json'));
    publisher.maxData = 2;

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent.map((request) => request.batchId)).toEqual(['batch-0']);
    expect(pendingFiles()).toContain('batch-0.json');
  });

  it('discards a lone datum the service still refuses as too large', async () => {
    await leavePending('batch-0', 1);
    publisher.maxData = 0;

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent).toHaveLength(1);
    expect(pendingFiles()).toEqual([]);
  });

  it('ends the backlog pass at an unreachable service, rather than waiting out a timeout per batch', async () => {
    for (const id of ['batch-a', 'batch-b', 'batch-c']) {
      await leavePending(id, 1);
    }
    publisher.failWith = new ServiceUnreachableError('POST /agent-api/metrics timed out after 10000ms.');
    publisher.failures = 99;

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent).toHaveLength(1);
    expect(pendingFiles()).toEqual(['batch-a.json', 'batch-b.json', 'batch-c.json']);
  });

  it.each([
    ['an unrecognised token', new UnauthenticatedError('A bearer token is required.')],
    ['a refused address', new ForbiddenError('This address may not reach the internal listener.')],
  ])('ends the pass on %s, which no batch would get past, and keeps them all', async (_description, failure) => {
    await leavePending('batch-a', 1);
    await leavePending('batch-b', 1);
    publisher.failWith = failure;
    publisher.failures = 99;

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent).toHaveLength(1);
    expect(pendingFiles()).toEqual(['batch-a.json', 'batch-b.json']);
  });

  it('moves past a batch the service failed on, so one batch cannot block the rest', async () => {
    await leavePending('batch-a', 1);
    await leavePending('batch-b', 1);
    publisher.failWith = new InternalServiceError('Internal server error (HTTP 500)');
    publisher.failures = 1;

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent.map((request) => request.batchId)).toEqual(['batch-a', 'batch-b']);
    expect(pendingFiles()).toEqual(['batch-a.json']);
  });

  it('gives a backlog one attempt each, so it cannot hold up the minute behind it', async () => {
    await write(aDocument(MINUTE + 10_000));
    publisher.failWith = new ServiceUnreachableError('connection refused');
    publisher.failures = 3;
    await collector.collect(MINUTE + 61_000);
    waits = [];

    publisher.failures = 1;
    await collector.collect(MINUTE + 121_000);

    expect(publisher.sent).toHaveLength(4);
    expect(waits).toEqual([]);
    expect(readdirSync(pendingDir())).toEqual(['batch-1.json']);
  });

  it('discards a pending file it cannot read rather than retrying it forever', async () => {
    await mkdir(pendingDir(), { recursive: true });
    await writeFile(path.join(pendingDir(), 'batch-0.json'), JSON.stringify({ nonsense: true }));

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent).toEqual([]);
    expect(readdirSync(pendingDir())).toEqual([]);
  });

  it('discards a pending file whose data has no minutes, and carries on with the tick', async () => {
    await mkdir(pendingDir(), { recursive: true });
    await writeFile(path.join(pendingDir(), 'batch-0.json'), JSON.stringify({ batchId: 'batch-0', data: [{ metricName: 'Latency' }] }));
    await write(aDocument(MINUTE + 10_000));

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent.map((request) => request.batchId)).toEqual(['batch-1']);
    expect(pendingFiles()).toEqual([]);
  });

  it('discards a pending file that will not parse, for the same reason', async () => {
    // It will not parse on the next tick either, so keeping it re-reads and re-logs
    // the same file every minute for as long as the agent runs.
    await mkdir(pendingDir(), { recursive: true });
    await writeFile(path.join(pendingDir(), 'batch-0.json'), '{"batchId": "b0", "data": [');

    await collector.collect(MINUTE + 61_000);

    expect(readdirSync(pendingDir())).toEqual([]);
  });
});

describe('splitByBytes', () => {
  const size = (data: ReadonlyArray<MetricDatum>): number => Buffer.byteLength(JSON.stringify(data));

  it('keeps every run under the limit, and the data in order', () => {
    const data = Array.from({ length: 50 }, (_, minute) => aDatum(minute));
    const limit = size(data.slice(0, 7));

    const runs = splitByBytes(data, limit);

    expect(runs.length).toBeGreaterThan(1);
    for (const run of runs) {
      expect(size(run)).toBeLessThanOrEqual(limit);
    }
    expect(runs.flat()).toEqual(data);
  });

  it('fills a run exactly to the limit when the data fits it exactly', () => {
    const data = Array.from({ length: 6 }, (_, minute) => aDatum(minute));

    expect(splitByBytes(data, size(data.slice(0, 3)))).toEqual([data.slice(0, 3), data.slice(3)]);
  });

  it('sends a datum over the limit on its own, rather than dropping it', () => {
    const big = aDatum(0, 'x'.repeat(500));

    expect(splitByBytes([aDatum(1), big, aDatum(2)], 300)).toEqual([[aDatum(1)], [big], [aDatum(2)]]);
  });

  it('has no runs for no data', () => {
    expect(splitByBytes([], MAX_BATCH_BYTES)).toEqual([]);
  });
});

describe('msUntilNextCollect', () => {
  it('aims at the offset plus jitter into the current minute when that is still ahead', () => {
    expect(msUntilNextCollect(MINUTE + 1_000, 2_000)).toBe(COLLECT_OFFSET_MS + 2_000 - 1_000);
  });

  it('aims at the next minute once the offset has passed', () => {
    expect(msUntilNextCollect(MINUTE + 30_000, 0)).toBe(60_000 - 30_000 + COLLECT_OFFSET_MS);
  });

  it('never collects twice in a minute when a smaller jitter follows a larger one', () => {
    const late = MINUTE + COLLECT_OFFSET_MS + 4_000;
    expect(late + msUntilNextCollect(late, 1_000)).toBe(MINUTE + 60_000 + COLLECT_OFFSET_MS + 1_000);
  });

  it('lands every collect within the jitter window past the offset, wherever it starts', () => {
    for (const start of [MINUTE, MINUTE + 4_999, MINUTE + 9_999, MINUTE + 17_123, MINUTE + 59_999]) {
      for (const jitter of [0, 2_500, COLLECT_JITTER_MS - 1]) {
        const second = (start + msUntilNextCollect(start, jitter)) % 60_000;
        expect(second).toBe(COLLECT_OFFSET_MS + jitter);
      }
    }
  });
});

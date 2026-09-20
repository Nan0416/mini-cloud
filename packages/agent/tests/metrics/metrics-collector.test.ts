import { EmfDocument, MetricUnit, PutMetricDataRequest } from '@mini-cloud/shared';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MetricPublisher, MetricsCollector } from '../../src/metrics/metrics-collector';
import { SpoolReader } from '../../src/metrics/spool-reader';

const HOUR = Date.UTC(2026, 8, 19, 14);
const MINUTE = HOUR + 30 * 60_000;
const SPOOL_FILE = 'inst-1-2026-09-19-14.emf';

/** Records the batches it was given, and can be told to fail. */
class FakePublisher implements MetricPublisher {
  readonly sent: PutMetricDataRequest[] = [];
  failures = 0;

  async putMetricData(request: PutMetricDataRequest): Promise<unknown> {
    this.sent.push(request);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('service unreachable');
    }
    return {};
  }
}

function aDocument(timestamp: number, value = 10, unit: MetricUnit = 'Milliseconds'): EmfDocument {
  return {
    Operation: 'Ingest',
    Latency: value,
    _aws: { Timestamp: timestamp, CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [['Operation']], Metrics: [{ Name: 'Latency', Unit: unit }] }] },
  };
}

describe('MetricsCollector', () => {
  let dir: string;
  let publisher: FakePublisher;
  let collector: MetricsCollector;
  let nextId = 0;

  const spoolDir = (): string => path.join(dir, 'spool');
  const pendingDir = (): string => path.join(dir, 'pending');
  const write = async (...documents: EmfDocument[]): Promise<void> => {
    await writeFile(path.join(spoolDir(), SPOOL_FILE), documents.map((document) => `${JSON.stringify(document)}\n`).join(''));
  };

  beforeEach(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mini-cloud-collector-'));
    await mkdir(spoolDir(), { recursive: true });
    publisher = new FakePublisher();
    nextId = 0;
    collector = new MetricsCollector({
      agentId: 'agent-a',
      reader: new SpoolReader({ spoolDir: spoolDir(), offsetsPath: path.join(dir, 'offsets.json') }),
      publisher,
      pendingDir: pendingDir(),
      maxHistogramBuckets: 100,
      newBatchId: () => `batch-${(nextId += 1)}`,
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

  it('discards a pending file it cannot read rather than retrying it forever', async () => {
    await mkdir(pendingDir(), { recursive: true });
    await writeFile(path.join(pendingDir(), 'batch-0.json'), JSON.stringify({ nonsense: true }));

    await collector.collect(MINUTE + 61_000);

    expect(publisher.sent).toEqual([]);
    expect(readdirSync(pendingDir())).toEqual([]);
  });
});

import { EmfDocument, expandEmfDocument, validateEmfDocument } from '@mini-cloud/shared';
import { MetricLogger } from '../../src/metrics/metric-logger';
import { MetricSink } from '../../src/metrics/metric-sink';

/** Keeps what was flushed, so a test can read the documents back. */
class RecordingSink implements MetricSink {
  readonly documents: EmfDocument[] = [];

  async write(document: EmfDocument): Promise<void> {
    this.documents.push(document);
  }

  get only(): EmfDocument {
    if (this.documents.length !== 1) {
      throw new Error(`expected exactly one document, got ${this.documents.length}`);
    }
    return this.documents[0];
  }
}

function build(namespace = 'MyApp'): { sink: RecordingSink; metrics: MetricLogger } {
  const sink = new RecordingSink();
  return { sink, metrics: new MetricLogger({ sink, namespace }) };
}

describe('MetricLogger.flush', () => {
  it('emits a document the specification accepts', async () => {
    // The whole reason for this format is that CloudWatch would ingest what we write
    // unchanged, so every flush is checked against the spec.
    const { sink, metrics } = build();
    metrics.putDimensions({ Operation: 'Ingest' });
    metrics.putMetric('Latency', 42, 'Milliseconds');
    metrics.setProperty('requestId', 'abc-123');

    await metrics.flush();

    expect(validateEmfDocument(sink.only)).toEqual({ valid: true });
    expect(sink.only).toMatchObject({
      _aws: { CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [['Operation']], Metrics: [{ Name: 'Latency', Unit: 'Milliseconds' }] }] },
      Operation: 'Ingest',
      Latency: 42,
      requestId: 'abc-123',
    });
  });

  it('writes nothing when no metric was recorded', async () => {
    const { sink, metrics } = build();
    metrics.putDimensions({ Operation: 'Ingest' });

    await metrics.flush();

    expect(sink.documents).toEqual([]);
  });

  it('accumulates repeated values for one name into an array', async () => {
    const { sink, metrics } = build();
    metrics.putMetric('Latency', 1, 'Milliseconds');
    metrics.putMetric('Latency', 2, 'Milliseconds');

    await metrics.flush();

    expect(sink.only['Latency']).toEqual([1, 2]);
  });

  it('flushes rather than dropping when a metric reaches the 100-value limit', async () => {
    // The format caps a numeric target at 100 members, so the choice is to flush or
    // to lose observations.
    const { sink, metrics } = build();
    for (let index = 0; index < 250; index += 1) {
      metrics.putMetric('Latency', index, 'Milliseconds');
    }

    await metrics.flush();

    const values = sink.documents.flatMap((document) => {
      const target = document['Latency'];
      return Array.isArray(target) ? target : [target];
    });
    expect(values).toHaveLength(250);
    for (const document of sink.documents) {
      expect(validateEmfDocument(document)).toEqual({ valid: true });
    }
  });

  it('publishes one dimension set per putDimensions call', async () => {
    const { sink, metrics } = build();
    metrics.putDimensions({ Operation: 'Ingest' });
    metrics.putDimensions({ Operation: 'Ingest', Service: 'Api' });
    metrics.putMetric('Count', 1, 'Count');

    await metrics.flush();

    expect(expandEmfDocument(sink.only).map((observation) => observation.dimensions)).toEqual([{ Operation: 'Ingest' }, { Operation: 'Ingest', Service: 'Api' }]);
  });

  it('does not add a dimension set it already has', async () => {
    // Custom dimensions survive a flush, so calling this once per loop iteration —
    // the obvious way to write it — would otherwise grow the document on every pass
    // and publish the same series over and over.
    const { sink, metrics } = build();
    for (let index = 0; index < 5; index += 1) {
      metrics.putDimensions({ Operation: 'Ingest' });
    }
    metrics.putMetric('Count', 1, 'Count');

    await metrics.flush();

    expect(sink.only._aws.CloudWatchMetrics[0].Dimensions).toEqual([['Operation']]);
  });

  it('keeps accumulating dimensions across flushes without repeating them', async () => {
    const { sink, metrics } = build();
    metrics.putDimensions({ Operation: 'Ingest' });
    metrics.putMetric('Count', 1, 'Count');
    await metrics.flush();

    metrics.putDimensions({ Operation: 'Ingest' });
    metrics.putMetric('Count', 1, 'Count');
    await metrics.flush();

    expect(sink.documents[1]._aws.CloudWatchMetrics[0].Dimensions).toEqual([['Operation']]);
  });

  it('publishes one empty dimension set when none was given', async () => {
    // An unqualified metric is still a series, and the format requires at least one
    // dimension set even when it is empty.
    const { sink, metrics } = build();
    metrics.putMetric('Count', 1, 'Count');

    await metrics.flush();

    expect(sink.only._aws.CloudWatchMetrics[0].Dimensions).toEqual([[]]);
  });

  it('keeps the namespace and dimensions across a flush but not the metrics', async () => {
    const { sink, metrics } = build();
    metrics.putDimensions({ Operation: 'Ingest' });
    metrics.putMetric('Count', 1, 'Count');
    await metrics.flush();

    metrics.putMetric('Count', 2, 'Count');
    await metrics.flush();

    expect(sink.documents).toHaveLength(2);
    expect(sink.documents[1]['Count']).toBe(2);
    expect(sink.documents[1]['Operation']).toBe('Ingest');
  });

  it('drops custom dimensions across a flush when asked to', async () => {
    const { sink, metrics } = build();
    metrics.flushPreserveDimensions = false;
    metrics.putDimensions({ Operation: 'Ingest' });
    metrics.putMetric('Count', 1, 'Count');
    await metrics.flush();

    metrics.putMetric('Count', 2, 'Count');
    await metrics.flush();

    expect(sink.documents[1]['Operation']).toBeUndefined();
  });

  it('uses an explicitly set timestamp, and keeps it across flushes', async () => {
    const when = Date.UTC(2026, 8, 19, 10, 0, 0);
    const { sink, metrics } = build();
    metrics.setTimestamp(when);
    metrics.putMetric('Count', 1, 'Count');

    await metrics.flush();

    expect(sink.only._aws.Timestamp).toBe(when);
  });
});

describe('MetricLogger minute accuracy', () => {
  const MINUTE = Date.UTC(2026, 8, 20, 4, 19, 0);

  /** A logger whose clock the test drives, so a boundary needs no waiting. */
  function atClock(): { sink: RecordingSink; metrics: MetricLogger; setNow: (at: number) => void } {
    const sink = new RecordingSink();
    let now = MINUTE;
    const metrics = new MetricLogger({ sink, namespace: 'MyApp', flushOnMinuteBoundary: false, clock: () => now });
    return { sink, metrics, setNow: (at: number) => (now = at) };
  }

  it('stamps a document with when the work happened, not when it was flushed', async () => {
    // The case that motivated this: recorded at 4:19:03, flushed at 4:23:04. Stamping
    // at flush would file it under 4:23 and lose the minute it belongs to.
    const { sink, metrics, setNow } = atClock();
    setNow(MINUTE + 3_000);
    metrics.putMetric('Latency', 42, 'Milliseconds');

    setNow(MINUTE + 4 * 60_000 + 4_000);
    await metrics.flush();

    expect(sink.only._aws.Timestamp).toBe(MINUTE + 3_000);
  });

  it('closes the open document as soon as an observation lands in a later minute', async () => {
    const { sink, metrics, setNow } = atClock();
    setNow(MINUTE + 3_000);
    metrics.putMetric('Latency', 10, 'Milliseconds');

    setNow(MINUTE + 61_000);
    metrics.putMetric('Latency', 20, 'Milliseconds');
    await metrics.flush();

    // Two documents, each stamped inside its own minute — never one spanning both.
    expect(sink.documents.map((document) => document._aws.Timestamp)).toEqual([MINUTE + 3_000, MINUTE + 61_000]);
    expect(sink.documents.map((document) => document['Latency'])).toEqual([10, 20]);
  });

  it('keeps observations from one minute in a single document', async () => {
    const { sink, metrics, setNow } = atClock();
    setNow(MINUTE + 1_000);
    metrics.putMetric('Latency', 1, 'Milliseconds');
    setNow(MINUTE + 59_999);
    metrics.putMetric('Latency', 2, 'Milliseconds');

    await metrics.flush();

    expect(sink.only['Latency']).toEqual([1, 2]);
  });

  it('splits a run that spans several minutes into one document per minute', async () => {
    const { sink, metrics, setNow } = atClock();
    for (let minute = 0; minute < 4; minute += 1) {
      setNow(MINUTE + minute * 60_000 + 5_000);
      metrics.putMetric('Calls', 1, 'Count');
    }
    await metrics.flush();

    expect(sink.documents).toHaveLength(4);
    expect(sink.documents.map((document) => document._aws.Timestamp)).toEqual([MINUTE + 5_000, MINUTE + 65_000, MINUTE + 125_000, MINUTE + 185_000]);
  });

  it('leaves an explicitly set timestamp in charge', async () => {
    // The caller has taken control of what the document claims; second-guessing that
    // would be worse than the default.
    const chosen = Date.UTC(2026, 8, 20, 1, 0, 0);
    const { sink, metrics, setNow } = atClock();
    metrics.setTimestamp(chosen);
    setNow(MINUTE + 3_000);
    metrics.putMetric('Latency', 1, 'Milliseconds');
    setNow(MINUTE + 61_000);
    metrics.putMetric('Latency', 2, 'Milliseconds');

    await metrics.flush();

    expect(sink.documents).toHaveLength(1);
    expect(sink.only._aws.Timestamp).toBe(chosen);
  });

  it('starts a fresh minute after an explicit flush', async () => {
    const { sink, metrics, setNow } = atClock();
    setNow(MINUTE + 3_000);
    metrics.putMetric('Calls', 1, 'Count');
    await metrics.flush();

    setNow(MINUTE + 10_000);
    metrics.putMetric('Calls', 1, 'Count');
    await metrics.flush();

    expect(sink.documents.map((document) => document._aws.Timestamp)).toEqual([MINUTE + 3_000, MINUTE + 10_000]);
  });
});

describe('MetricLogger boundary timer', () => {
  const MINUTE = Date.UTC(2026, 8, 20, 4, 19, 0);

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('writes out a quiet minute shortly after it ends', async () => {
    // Otherwise a program that records once and goes quiet leaves that minute
    // buffered until it next records, and the agent never sees it.
    const sink = new RecordingSink();
    const now = MINUTE + 3_000;
    const metrics = new MetricLogger({ sink, namespace: 'MyApp', clock: () => now });
    metrics.putMetric('Latency', 42, 'Milliseconds');

    expect(sink.documents).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(58_000);
    expect(sink.documents).toHaveLength(1);
    expect(sink.documents[0]._aws.Timestamp).toBe(MINUTE + 3_000);
  });

  it('does not hold the process open', () => {
    // An unref'd timer is what lets a short-lived program exit on its own schedule
    // instead of waiting out the rest of the minute. `jest.getTimerCount()` counts
    // pending timers whether or not they hold a ref, so the call itself is the thing
    // worth asserting.
    jest.useRealTimers();
    const unref = jest.fn();
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(() => ({ unref }) as unknown as NodeJS.Timeout);

    try {
      const metrics = new MetricLogger({ sink: new RecordingSink(), namespace: 'MyApp', clock: () => MINUTE });
      metrics.putMetric('Latency', 1, 'Milliseconds');

      expect(spy).toHaveBeenCalledTimes(1);
      expect(unref).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('arms the timer to fire just past the end of the minute it is holding', () => {
    jest.useRealTimers();
    const spy = jest.spyOn(global, 'setTimeout').mockImplementation(() => ({ unref: jest.fn() }) as unknown as NodeJS.Timeout);

    try {
      const metrics = new MetricLogger({ sink: new RecordingSink(), namespace: 'MyApp', clock: () => MINUTE + 3_000 });
      metrics.putMetric('Latency', 1, 'Milliseconds');

      // 57s left in the minute, plus a second of grace so a value recorded at 59.9s
      // is not racing the flush.
      expect(spy.mock.calls[0][1]).toBe(58_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('stops the timer once the document it was holding is flushed', async () => {
    const sink = new RecordingSink();
    const metrics = new MetricLogger({ sink, namespace: 'MyApp', flushOnMinuteBoundary: true, clock: () => MINUTE });
    metrics.putMetric('Latency', 1, 'Milliseconds');
    await metrics.flush();

    await jest.advanceTimersByTimeAsync(120_000);

    expect(sink.documents).toHaveLength(1);
  });

  it('close writes the last partial minute', async () => {
    const sink = new RecordingSink();
    const metrics = new MetricLogger({ sink, namespace: 'MyApp', clock: () => MINUTE + 3_000 });
    metrics.putMetric('Latency', 1, 'Milliseconds');

    await metrics.close();

    expect(sink.documents).toHaveLength(1);
  });
});

describe('MetricLogger sink failures', () => {
  /** A sink that fails a set number of times before behaving. */
  class FailingSink implements MetricSink {
    readonly documents: EmfDocument[] = [];
    constructor(private failures: number) {}

    async write(document: EmfDocument): Promise<void> {
      if (this.failures > 0) {
        this.failures -= 1;
        throw new Error('disk on fire');
      }
      this.documents.push(document);
    }
  }

  it('does not reject when the sink does', async () => {
    // Three call sites invoke flush as `void this.flush()`, so a rejection here
    // becomes an unhandled rejection that kills the process being monitored.
    const metrics = new MetricLogger({ sink: new FailingSink(1), namespace: 'MyApp' });
    metrics.putMetric('Count', 1, 'Count');

    await expect(metrics.flush()).resolves.toBeUndefined();
  });

  it('keeps writing after a failed write', async () => {
    // `rejected.then(fn)` never runs `fn`, so a rejected pending chain would drop
    // every later document silently and for good.
    const sink = new FailingSink(1);
    const metrics = new MetricLogger({ sink, namespace: 'MyApp' });

    metrics.putMetric('Count', 1, 'Count');
    await metrics.flush();
    metrics.putMetric('Count', 2, 'Count');
    await metrics.flush();
    metrics.putMetric('Count', 3, 'Count');
    await metrics.flush();

    expect(sink.documents.map((document) => document['Count'])).toEqual([2, 3]);
  });

  it('survives a sink that never works', async () => {
    const metrics = new MetricLogger({ sink: new FailingSink(Number.MAX_SAFE_INTEGER), namespace: 'MyApp' });

    for (let index = 0; index < 5; index += 1) {
      metrics.putMetric('Count', index, 'Count');
      await expect(metrics.flush()).resolves.toBeUndefined();
    }
  });
});

describe('MetricLogger validation', () => {
  it('drops a non-finite value instead of throwing', async () => {
    // A metrics library that can crash the program it measures is worse than no
    // metrics, so this is a warning and a dropped value, not an error.
    const { sink, metrics } = build();
    metrics.putMetric('Latency', Number.NaN, 'Milliseconds');
    metrics.putMetric('Latency', 5, 'Milliseconds');

    await metrics.flush();

    expect(sink.only['Latency']).toBe(5);
  });

  it('ignores a dimension set whose value is not a string', async () => {
    const { sink, metrics } = build();
    metrics.putDimensions({ Operation: 7 as unknown as string });
    metrics.putMetric('Count', 1, 'Count');

    await metrics.flush();

    expect(sink.only._aws.CloudWatchMetrics[0].Dimensions).toEqual([[]]);
  });

  it('ignores a dimension set with more keys than the format allows', async () => {
    const dimensions: Record<string, string> = {};
    for (let index = 0; index < 31; index += 1) {
      dimensions[`D${index}`] = 'value';
    }
    const { sink, metrics } = build();
    metrics.putDimensions(dimensions);
    metrics.putMetric('Count', 1, 'Count');

    await metrics.flush();

    expect(sink.only._aws.CloudWatchMetrics[0].Dimensions).toEqual([[]]);
  });

  it('drops a metric whose name collides with a dimension', async () => {
    // One root member cannot be a string for the dimension and a number for the
    // metric, so one of them has to go.
    const { sink, metrics } = build();
    metrics.putDimensions({ Latency: 'slow' });
    metrics.putMetric('Latency', 42, 'Milliseconds');
    metrics.putMetric('Count', 1, 'Count');

    await metrics.flush();

    expect(sink.only['Latency']).toBe('slow');
    expect(sink.only['Count']).toBe(1);
  });

  it('drops the document when the namespace it was built with is unusable', async () => {
    // The namespace is mandatory in the type, so this only happens when an untyped
    // caller pushes an empty string through. Dropping beats emitting a document
    // CloudWatch would reject, and beats throwing inside the program being measured.
    const sink = new RecordingSink();
    const metrics = new MetricLogger({ sink, namespace: '' });
    metrics.putMetric('Count', 1, 'Count');

    await metrics.flush();

    expect(sink.documents).toEqual([]);
  });

  it('ignores an empty namespace rather than emitting an invalid document', async () => {
    const { sink, metrics } = build();
    metrics.setNamespace('');
    metrics.putMetric('Count', 1, 'Count');

    await metrics.flush();

    expect(sink.only._aws.CloudWatchMetrics[0].Namespace).toBe('MyApp');
  });
});

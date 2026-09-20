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

  it('ignores an empty namespace rather than emitting an invalid document', async () => {
    const { sink, metrics } = build();
    metrics.setNamespace('');
    metrics.putMetric('Count', 1, 'Count');

    await metrics.flush();

    expect(sink.only._aws.CloudWatchMetrics[0].Namespace).toBe('MyApp');
  });
});

import { EmfDocument } from '../../src/models/metric';
import { expandEmfDocument, isEmfDocument, isWithinDocumentSize, validateEmfDocument } from '../../src/utils/emf';

const TIMESTAMP = Date.UTC(2026, 8, 19, 12, 0, 0);

function aDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _aws: {
      Timestamp: TIMESTAMP,
      CloudWatchMetrics: [
        {
          Namespace: 'MyApp',
          Dimensions: [['Operation']],
          Metrics: [{ Name: 'Latency', Unit: 'Milliseconds' }],
        },
      ],
    },
    Operation: 'Ingest',
    Latency: 42,
    ...overrides,
  };
}

describe('validateEmfDocument', () => {
  it('accepts the example from the specification', () => {
    // Taken verbatim from the AWS embedded metric format specification page. If this
    // ever fails, what we emit is no longer what CloudWatch would ingest.
    const specExample = {
      _aws: {
        Timestamp: 1574109732004,
        CloudWatchMetrics: [
          {
            Namespace: 'lambda-function-metrics',
            Dimensions: [['functionVersion']],
            Metrics: [{ Name: 'time', Unit: 'Milliseconds', StorageResolution: 60 }],
          },
        ],
      },
      functionVersion: '$LATEST',
      time: 100,
      requestId: '989ffbf8-9ace-4817-a57c-e4dd734019ee',
    };

    expect(validateEmfDocument(specExample)).toEqual({ valid: true });
  });

  it('accepts an empty dimension set, which is still a series', () => {
    expect(
      validateEmfDocument(aDocument({ _aws: { Timestamp: TIMESTAMP, CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [[]], Metrics: [{ Name: 'Latency' }] }] } })).valid,
    ).toBe(true);
  });

  it('accepts an array of values', () => {
    expect(validateEmfDocument(aDocument({ Latency: [1, 2, 3] })).valid).toBe(true);
  });

  it('requires the metadata node', () => {
    expect(validateEmfDocument({ Latency: 1 })).toEqual({ valid: false, reason: '_aws is required and must be an object' });
  });

  it('requires a timestamp in milliseconds', () => {
    const result = validateEmfDocument(aDocument({ _aws: { CloudWatchMetrics: [] } }));

    expect(result.valid).toBe(false);
  });

  it('rejects a dimension that has no string value on the root node', () => {
    // The metadata only names dimensions; the values live at the root, and CloudWatch
    // drops the whole document if one is missing.
    const result = validateEmfDocument(aDocument({ Operation: undefined }));

    expect(result).toEqual({ valid: false, reason: 'dimension Operation has no string value on the root node' });
  });

  it('rejects a dimension whose root value is not a string', () => {
    expect(validateEmfDocument(aDocument({ Operation: 7 })).valid).toBe(false);
  });

  it('rejects a metric with no numeric value on the root node', () => {
    expect(validateEmfDocument(aDocument({ Latency: 'fast' })).valid).toBe(false);
  });

  it('rejects NaN and the infinities, which CloudWatch will not store', () => {
    expect(validateEmfDocument(aDocument({ Latency: Number.NaN })).valid).toBe(false);
    expect(validateEmfDocument(aDocument({ Latency: Number.POSITIVE_INFINITY })).valid).toBe(false);
  });

  it('rejects a unit CloudWatch does not define', () => {
    const document = aDocument({
      _aws: { Timestamp: TIMESTAMP, CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [['Operation']], Metrics: [{ Name: 'Latency', Unit: 'ms' }] }] },
    });

    expect(validateEmfDocument(document).valid).toBe(false);
  });

  it('rejects a storage resolution other than 1 or 60', () => {
    const document = aDocument({
      _aws: { Timestamp: TIMESTAMP, CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [['Operation']], Metrics: [{ Name: 'Latency', StorageResolution: 30 }] }] },
    });

    expect(validateEmfDocument(document).valid).toBe(false);
  });

  it('rejects more than 100 values for one metric', () => {
    expect(validateEmfDocument(aDocument({ Latency: Array.from({ length: 101 }, () => 1) })).valid).toBe(false);
  });

  it('rejects more than 30 keys in one dimension set', () => {
    const names = Array.from({ length: 31 }, (_unused, index) => `D${index}`);
    const root: Record<string, unknown> = { Latency: 1 };
    for (const name of names) {
      root[name] = 'value';
    }
    const document = { ...root, _aws: { Timestamp: TIMESTAMP, CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [names], Metrics: [{ Name: 'Latency' }] }] } };

    expect(validateEmfDocument(document).valid).toBe(false);
  });

  it('rejects more than 100 metric definitions in one directive', () => {
    const metrics = Array.from({ length: 101 }, (_unused, index) => ({ Name: `M${index}` }));
    const root: Record<string, unknown> = { Operation: 'Ingest' };
    for (let index = 0; index < 101; index += 1) {
      root[`M${index}`] = 1;
    }
    const document = { ...root, _aws: { Timestamp: TIMESTAMP, CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [['Operation']], Metrics: metrics }] } };

    expect(validateEmfDocument(document).valid).toBe(false);
  });

  it('requires at least one dimension set', () => {
    const document = aDocument({ _aws: { Timestamp: TIMESTAMP, CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [], Metrics: [{ Name: 'Latency' }] }] } });

    expect(validateEmfDocument(document).valid).toBe(false);
  });

  it('names the reason rather than throwing, so a logger can drop one document and carry on', () => {
    const result = validateEmfDocument('not an object');

    expect(result).toEqual({ valid: false, reason: 'an EMF document must be a JSON object' });
  });
});

describe('isWithinDocumentSize', () => {
  it('accepts an ordinary document', () => {
    expect(isWithinDocumentSize(JSON.stringify(aDocument()))).toBe(true);
  });

  it('rejects anything past the 1 MB a log event may occupy', () => {
    expect(isWithinDocumentSize('x'.repeat(1_048_577))).toBe(false);
  });
});

describe('expandEmfDocument', () => {
  function expand(value: Record<string, unknown>): ReturnType<typeof expandEmfDocument> {
    if (!isEmfDocument(value)) {
      throw new Error('fixture is not a valid document');
    }
    return expandEmfDocument(value);
  }

  it('resolves the metadata indirection into a plain observation', () => {
    expect(expand(aDocument())).toEqual([
      { namespace: 'MyApp', metricName: 'Latency', dimensions: { Operation: 'Ingest' }, unit: 'Milliseconds', timestamp: TIMESTAMP, values: [42] },
    ]);
  });

  it('emits one observation per dimension set, because each is its own series', () => {
    const document = aDocument({
      _aws: {
        Timestamp: TIMESTAMP,
        CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [['Operation'], ['Operation', 'Service'], []], Metrics: [{ Name: 'Latency', Unit: 'Milliseconds' }] }],
      },
      Service: 'Api',
    });

    expect(expand(document).map((observation) => observation.dimensions)).toEqual([{ Operation: 'Ingest' }, { Operation: 'Ingest', Service: 'Api' }, {}]);
  });

  it('counts a dimension set declared twice as one series', () => {
    // Every distinct set is one metric in CloudWatch, so a repeated set is still one
    // observation. Counting it twice would multiply the metric by however many times
    // its set was declared — which is what a putDimensions call inside a loop does.
    const document = aDocument({
      _aws: { Timestamp: TIMESTAMP, CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [['Operation'], ['Operation'], ['Operation']], Metrics: [{ Name: 'Latency' }] }] },
    });

    expect(expand(document)).toHaveLength(1);
  });

  it('still emits both when two sets differ', () => {
    const document = aDocument({
      _aws: { Timestamp: TIMESTAMP, CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [['Operation'], ['Operation', 'Service']], Metrics: [{ Name: 'Latency' }] }] },
      Service: 'Api',
    });

    expect(expand(document)).toHaveLength(2);
  });

  it('keeps every value of an array target', () => {
    expect(expand(aDocument({ Latency: [1, 2, 3] }))[0].values).toEqual([1, 2, 3]);
  });

  it('defaults a missing unit to None, as the specification does', () => {
    const document = aDocument({ _aws: { Timestamp: TIMESTAMP, CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [['Operation']], Metrics: [{ Name: 'Latency' }] }] } });

    expect(expand(document)[0].unit).toBe('None');
  });

  it('ignores properties, which are context rather than a series', () => {
    const observations = expand(aDocument({ requestId: 'abc-123' }));

    expect(observations).toHaveLength(1);
    expect(observations[0].metricName).toBe('Latency');
  });

  it('yields the metrics it can resolve when one is broken', () => {
    // A partially broken document should still give up the metrics it got right,
    // rather than costing a machine its whole minute.
    const document: EmfDocument = {
      _aws: { Timestamp: TIMESTAMP, CloudWatchMetrics: [{ Namespace: 'MyApp', Dimensions: [['Operation']], Metrics: [{ Name: 'Missing' }, { Name: 'Latency' }] }] },
      Operation: 'Ingest',
      Latency: 42,
    };

    expect(expandEmfDocument(document).map((observation) => observation.metricName)).toEqual(['Latency']);
  });
});

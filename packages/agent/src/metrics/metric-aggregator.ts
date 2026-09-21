import {
  EmfDocument,
  LoggerFactory,
  MetricDatum,
  MetricDimensions,
  MetricHistogram,
  MetricUnit,
  compactHistogram,
  expandEmfDocument,
  floorToResolution,
  hashDimensions,
  histogramFrom,
  isEmfDocument,
  mergeHistograms,
  statisticsFrom,
} from '@mini-cloud/shared';

const logger = LoggerFactory.getLogger('MetricAggregator');

export interface AggregateOptions {
  readonly maxHistogramBuckets: number;
}

interface Accumulator {
  readonly namespace: string;
  readonly metricName: string;
  readonly dimensions: MetricDimensions;
  readonly unit: MetricUnit;
  readonly bucketStart: number;
  histogram: MetricHistogram;
}

/** Parses spooled lines, skipping anything that is not a valid document. */
export function parseSpoolLines(lines: ReadonlyArray<string>): ReadonlyArray<EmfDocument> {
  const documents: EmfDocument[] = [];
  let skipped = 0;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      skipped += 1;
      continue;
    }
    if (!isEmfDocument(parsed)) {
      skipped += 1;
      continue;
    }
    documents.push(parsed);
  }

  if (skipped > 0) {
    logger.warn(`Skipped ${skipped} spooled line(s) that were not valid metric documents.`);
  }
  return documents;
}

/**
 * Folds documents into one datum per metric, per dimension set, per minute.
 *
 * The minute is the unit everything downstream is keyed on, so this is where
 * individual observation timestamps are given up. What is kept is the distribution,
 * which is what lets a percentile be answered later without storing every value.
 *
 * A unit that disagrees with an earlier one for the same metric is logged and the
 * first is kept. The legacy aggregator threw instead, which meant one mislabelled
 * metric cost the machine its whole minute.
 */
export function aggregate(documents: ReadonlyArray<EmfDocument>, options: AggregateOptions): ReadonlyArray<MetricDatum> {
  const accumulators = new Map<string, Accumulator>();

  for (const document of documents) {
    for (const observation of expandEmfDocument(document)) {
      const bucketStart = floorToResolution(observation.timestamp, '1m');
      const hash = hashDimensions(observation.dimensions);
      const key = JSON.stringify([observation.namespace, observation.metricName, hash, bucketStart]);

      const existing = accumulators.get(key);
      if (existing === undefined) {
        accumulators.set(key, {
          namespace: observation.namespace,
          metricName: observation.metricName,
          dimensions: observation.dimensions,
          unit: observation.unit,
          bucketStart,
          histogram: histogramFrom(observation.values),
        });
        continue;
      }
      if (existing.unit !== observation.unit) {
        logger.warn(`Metric ${observation.namespace}/${observation.metricName} was reported as both ${existing.unit} and ${observation.unit}; keeping ${existing.unit}.`);
      }
      existing.histogram = mergeHistograms(existing.histogram, histogramFrom(observation.values));
    }
  }

  return Array.from(accumulators.values()).map((accumulator) => {
    // Statistics come from the full distribution and the histogram is compacted
    // afterwards, so count, sum, min and max stay exact however much rounding the
    // distribution needed.
    const statistics = statisticsFrom(accumulator.histogram);
    return {
      namespace: accumulator.namespace,
      metricName: accumulator.metricName,
      dimensions: accumulator.dimensions,
      unit: accumulator.unit,
      bucketStart: accumulator.bucketStart,
      sampleCount: statistics.sampleCount,
      sum: statistics.sum,
      min: statistics.min,
      max: statistics.max,
      histogram: compactHistogram(accumulator.histogram, options.maxHistogramBuckets),
    };
  });
}

export interface SealResult {
  /** Buckets whose minute has fully elapsed, and so will never gain another value. */
  readonly sealed: ReadonlyArray<MetricDatum>;
  /** Buckets still open, to be carried to the next tick. */
  readonly open: ReadonlyArray<MetricDatum>;
}

/**
 * Splits data into what may be sent and what must wait.
 *
 * A bucket is sealed once its minute has passed, and a sealed bucket is never
 * revised. That is what makes a batch stable enough to retry: the same batch id can be
 * resent verbatim, and the service recognises it rather than adding it again.
 */
export function sealBuckets(data: ReadonlyArray<MetricDatum>, now: number): SealResult {
  const boundary = floorToResolution(now, '1m');
  const sealed: MetricDatum[] = [];
  const open: MetricDatum[] = [];

  for (const datum of data) {
    if (datum.bucketStart < boundary) {
      sealed.push(datum);
    } else {
      open.push(datum);
    }
  }

  return { sealed, open };
}

/**
 * Combines carried-over open buckets with newly read ones.
 *
 * Compaction is re-applied, because merging two already-compacted distributions
 * yields the union of their buckets. A minute carried across several ticks would
 * otherwise accumulate well past `maxHistogramBuckets` before it was ever sealed.
 */
export function mergeData(left: ReadonlyArray<MetricDatum>, right: ReadonlyArray<MetricDatum>, options: AggregateOptions): ReadonlyArray<MetricDatum> {
  const merged = new Map<string, MetricDatum>();

  for (const datum of [...left, ...right]) {
    const key = JSON.stringify([datum.namespace, datum.metricName, hashDimensions(datum.dimensions), datum.bucketStart]);
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, datum);
      continue;
    }
    merged.set(key, {
      ...existing,
      sampleCount: existing.sampleCount + datum.sampleCount,
      sum: existing.sum + datum.sum,
      min: Math.min(existing.min, datum.min),
      max: Math.max(existing.max, datum.max),
      histogram: compactHistogram(mergeHistograms(existing.histogram, datum.histogram), options.maxHistogramBuckets),
    });
  }

  return Array.from(merged.values());
}

import { MetricHistogram, MetricStatisticSet } from '../models/metric';

/**
 * A metric's distribution, as value-to-count pairs.
 *
 * Keeping the distribution rather than every observation is what lets percentiles be
 * computed after the fact without storing raw data forever. Merging is addition per
 * value, so it is commutative and associative: several agents reporting the same
 * minute produce the same histogram whatever order they arrive in.
 */

/** Parses a histogram key back to the number it encodes. */
function toValue(key: string): number {
  return Number(key);
}

/**
 * Keys are `String(value)` of an already-rounded number, so the same observation from
 * two machines lands in the same bucket.
 */
function toKey(value: number): string {
  return String(value);
}

export function histogramFrom(values: ReadonlyArray<number>): MetricHistogram {
  const histogram: Record<string, number> = {};
  for (const value of values) {
    const key = toKey(value);
    histogram[key] = (histogram[key] ?? 0) + 1;
  }
  return histogram;
}

export function mergeHistograms(left: MetricHistogram, right: MetricHistogram): MetricHistogram {
  const merged: Record<string, number> = {};
  for (const [key, count] of Object.entries(left)) {
    merged[key] = (merged[key] ?? 0) + count;
  }
  for (const [key, count] of Object.entries(right)) {
    merged[key] = (merged[key] ?? 0) + count;
  }
  return merged;
}

export function observationCount(histogram: MetricHistogram): number {
  let total = 0;
  for (const count of Object.values(histogram)) {
    total += count;
  }
  return total;
}

/**
 * Reduces the number of distinct values until it fits, by keeping fewer significant
 * figures.
 *
 * Starts exact and only rounds when it has to, so ordinary metrics keep their real
 * values and only a pathological one — a latency measured in nanoseconds, say — is
 * approximated. The rounding is deterministic, so two agents rounding the same
 * observation still land in the same bucket and merging does not multiply the count.
 *
 * The total observation count is never changed by this; only the precision of the
 * values is. Exact extremes live in the statistic set alongside, not here.
 */
export function compactHistogram(histogram: MetricHistogram, maxBuckets: number): MetricHistogram {
  if (Object.keys(histogram).length <= maxBuckets) {
    return histogram;
  }

  for (const digits of [3, 2, 1]) {
    const rounded: Record<string, number> = {};
    for (const [key, count] of Object.entries(histogram)) {
      const value = toValue(key);
      const roundedKey = toKey(Number.isFinite(value) && value !== 0 ? Number(value.toPrecision(digits)) : value);
      rounded[roundedKey] = (rounded[roundedKey] ?? 0) + count;
    }
    if (Object.keys(rounded).length <= maxBuckets || digits === 1) {
      return rounded;
    }
  }

  return histogram;
}

export function statisticsFrom(histogram: MetricHistogram): MetricStatisticSet {
  let sampleCount = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const [key, count] of Object.entries(histogram)) {
    const value = toValue(key);
    sampleCount += count;
    sum += value * count;
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  if (sampleCount === 0) {
    return { sampleCount: 0, sum: 0, min: 0, max: 0 };
  }
  return { sampleCount, sum, min, max };
}

/**
 * The nearest-rank percentile: the smallest value at or below which at least `p` of
 * the observations fall.
 *
 * Values are compared numerically. The legacy implementation sorted them as strings,
 * which put 10 before 2 and made every percentile wrong for any metric whose values
 * spanned different digit counts — which is to say, every latency metric.
 */
export function percentileFrom(histogram: MetricHistogram, percentile: number): number {
  const entries = Object.entries(histogram)
    .map(([key, count]) => ({ value: toValue(key), count }))
    .sort((left, right) => left.value - right.value);

  const total = entries.reduce((count, entry) => count + entry.count, 0);
  if (total === 0) {
    return 0;
  }

  const rank = Math.max(1, Math.ceil(total * percentile));
  let seen = 0;
  for (const entry of entries) {
    seen += entry.count;
    if (seen >= rank) {
      return entry.value;
    }
  }
  return entries[entries.length - 1].value;
}

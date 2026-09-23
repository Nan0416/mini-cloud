import { MetricStatistic, MetricUnit } from '../models/metric';

/**
 * What a statistic of a series is measured in.
 *
 * Every statistic but one is in the metric's own unit. `count` is how many observations
 * there were, which is a count whatever they measured: a count of a `Seconds` metric read
 * as seconds would be drawn as minutes and put on an axis of durations.
 */
export function unitForStatistic(statistic: MetricStatistic, unit: MetricUnit): MetricUnit {
  return statistic === 'count' ? 'Count' : unit;
}

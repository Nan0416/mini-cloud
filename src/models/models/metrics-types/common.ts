export type MetricValueUnit = 'ms' | 'count' | 'dollar' | 'percent' | 'unitless';

export type MetricStat = 'max' | 'min' | 'avg' | 'p99' | 'p95' | 'p90' | 'p75' | 'p50' | 'p25' | 'p10' | 'count' | 'sum';

export type MetricReferenceTtl = '2weeks' | '3months' | '6months';

/**
 * dimesions used to report and query
 */
export interface Dimensions {
  [key: string]: string;
}

/**
 * dimensions stored in metadata.
 *
 * A metric can have a different values on the same key.
 *
 * CreateMarketOrderLatency, .e.g. key: symbol, value: can be AAPL, BA, etc.
 */
export interface Dimension {
  readonly key: string;
  readonly value: string;
}

export interface TimeValue {
  readonly t: number;
  readonly v: number;
}

/**
 * Raw metric item emitted by client processes.
 */
export interface MetricItem {
  readonly namespace: string;
  // object vs. array: object doesn't allow a key to have multiple values.
  // todo:
  // as for now, we keep the Dimensions type for backward compatibiltiy because some clients still log the Object dimensions.
  // and the aggregator needs to understand them.
  readonly dimensions?: ReadonlyArray<Dimension> | Dimensions;
  readonly name: string;
  readonly value: number;
  readonly unit: MetricValueUnit;
  readonly timestamp: number;
}

import { Dimension, MetricValueUnit } from '../common';
import { BasePartition } from './common';

export interface NamespacePartition extends BasePartition {
  readonly by: 'namespace';
  readonly _v: 2;

  readonly namespace: string;
  readonly period: number; // in ms.
  readonly startTimestamp: number; // duration is same as period
  // has the same dimensions
  readonly dimensionAggregations: DimensionAggregation[];
}

export interface DimensionAggregation {
  readonly dimensions: Dimension[]; // aggregated metrics have the same dimensions.
  readonly metricItems: MetricNameAggregation[];
}

export interface MetricNameAggregation {
  readonly name: string;
  readonly unit: MetricValueUnit;
  readonly values: number[];
}

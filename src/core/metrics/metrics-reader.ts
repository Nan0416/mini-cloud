import { Partition, BasePartition, Dimension, Dimensions, MetricStat, MetricValueUnit, TimeValue } from '../../models';

export interface ReadingInput {
  readonly namespace: string;
  readonly metricName: string;
  readonly stat: MetricStat;
  readonly dimensions?: Dimensions | ReadonlyArray<Dimension>;
  readonly period: number;
  readonly from: number;
  readonly to?: number;
}

export interface ReadingOutput {
  readonly unit: MetricValueUnit;
  readonly datapoints: TimeValue[];
}

export interface MetricReader {
  read(data: ReadonlyArray<Partition>, input: ReadingInput): ReadingOutput | undefined;
}

export interface PartitionReadingInput {
  readonly namespace: string;
  readonly metricName: string;
  readonly dimensions?: Dimensions | ReadonlyArray<Dimension>;
  readonly from: number;
  readonly to?: number;
}

export interface PartitionExtract {
  readonly startTimestamp: number;
  readonly values: ReadonlyArray<number>;
}

export interface PartitionReadingOutput {
  readonly period: number;
  readonly extracts: PartitionExtract[];
}

export interface PartitionUnitReadingInput {
  readonly namespace: string;
  readonly metricName: string;
  readonly stat: MetricStat;
}

export interface MetricPartitionReader<T extends BasePartition> {
  /**
   * Extract the request input from the partition list.
   *
   * Partitions in the list are guaranteed to have the same period.
   * The output returns items within the request period [from, to]
   * @param data
   * @param input
   */
  data(data: ReadonlyArray<T>, input: PartitionReadingInput): PartitionReadingOutput | undefined;
  unit(data: ReadonlyArray<T>, input: PartitionUnitReadingInput): MetricValueUnit | undefined;
}

export type PartitionType = 'namespace' | 'metric' | 'placeholder';

export interface BasePartition {
  /**
   * default namespace for backward compatibility.
   */
  readonly by?: PartitionType;

  /**
   * version
   */
  readonly _v?: number;
}

export interface TimeRange {
  readonly startTimestamp: number;
  readonly endTimestamp: number;
}

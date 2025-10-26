import { MetricPartition } from './metric-partition';
import { NamespaceDimensionsPartition } from './namespace-dimensions-partition';
import { NamespacePartition } from './namespace-partition';
export type Partition = NamespaceDimensionsPartition | MetricPartition | NamespacePartition;

export * from './metric-partition';
export * from './namespace-dimensions-partition';
export * from './namespace-partition';
export * from './common';

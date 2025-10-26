import { Dimension } from './common';

export interface MetricMetadata {
  readonly namespace: string;
  readonly metricName: string;
  readonly dimensions?: Dimension[];
  readonly createdAt: number;
  readonly lastUpdatedAt: number;
}

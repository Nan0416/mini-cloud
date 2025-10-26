import { Partition } from '../models';
import { LoadTemporaryMetricsRequest, UploadMetricPartitionRequest } from './metrics-aggregator-request-response';

export interface MetricsClientForPartitioner {
  listNamespaces(): Promise<string[]>;

  loadTemporaryMetrics(request: LoadTemporaryMetricsRequest, concurrency?: number): Promise<Partition[]>;

  uploadMetrics(request: UploadMetricPartitionRequest): Promise<void>;
}

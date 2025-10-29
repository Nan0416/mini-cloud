import { LoadMetricsRequest, Partition } from '@ultrasa/mini-cloud-models';

export interface PartitionStore {
  terminate(): Promise<void>;
  cache(partition: Partition): Promise<void>;
  read(request: LoadMetricsRequest): Promise<Partition[]>;
}

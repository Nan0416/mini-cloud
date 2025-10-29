import { Partition } from '@ultrasa/mini-cloud-models';

export interface MetricsProcessor {
  process(metrics: ReadonlyArray<Partition>): Promise<void>;
}

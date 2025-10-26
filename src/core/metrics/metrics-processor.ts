import { Partition } from '../../models';

export interface MetricsProcessor {
  process(metrics: ReadonlyArray<Partition>): Promise<void>;
}

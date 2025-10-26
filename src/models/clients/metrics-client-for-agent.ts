import { UploadRawMetricsRequest } from './metrics-agent-request-response';

export interface MetricsClientForAgent {
  uploadRawMetrics(request: UploadRawMetricsRequest): Promise<void>;
}

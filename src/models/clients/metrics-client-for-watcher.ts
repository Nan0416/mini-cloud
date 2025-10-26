import {
  CompleteTemporaryRawMetricsProcessingRequest,
  CompleteTemporaryRawMetricsProcessingResponse,
  GetMetricDimensionsRequest,
  GetMetricDimensionsResponse,
  ListTemporaryRawMetricReferencesResponse,
  ListTemporaryRawMetricsReferencesRequest,
  UploadTemporaryMetricPartitionRequest,
  UpsertMetricDimensionsRequest,
} from './metrics-aggregator-request-response';

export interface MetricsClientForWatcher {
  listTemporaryRawMetricsReference(request: ListTemporaryRawMetricsReferencesRequest): Promise<ListTemporaryRawMetricReferencesResponse>;

  completeTemporaryRawMetricsProcessing(request: CompleteTemporaryRawMetricsProcessingRequest): Promise<CompleteTemporaryRawMetricsProcessingResponse>;

  uploadTemporaryMetrics(request: UploadTemporaryMetricPartitionRequest): Promise<void>;

  getDimensions(request: GetMetricDimensionsRequest): Promise<GetMetricDimensionsResponse>;

  upsertMetricDimensions(request: UpsertMetricDimensionsRequest): Promise<void>;
}

import {
  Dimension,
  MetricMetadata,
  MetricReference,
  RawMetricsReference,
  CreateTemporaryMetricReferenceRequest,
  ListTemporaryRawMetricsReferencesRequest,
  ListTemporaryMetricReferenceRequest,
  ListMetricMetadataRequest,
  CreateMetricReferenceRequest,
  CreateTemporaryRawMetricsReferenceRequest,
  CreateTemporaryRawMetricsReferenceResponse,
  CompleteTemporaryRawMetricsUploadRequest,
  CompleteTemporaryRawMetricsProcessingRequest,
  ListMetricReferencesRequest,
  CompleteTemporaryMetricUploadRequest,
} from '@ultrasa/mini-cloud-models';

// export interface DeleteTemporaryMetricReferenceRequest {
//   readonly namespace: string;
//   readonly period: number;
//   readonly startTimestamp: number;
// }

/**
 * given a namespace and an optional dimension, want to query what metrics it has.
 * given a namespace and a metric name, want to query what dimensions it has.
 */
export interface MetricsFacade {
  // initalize cache, etc.
  init(): Promise<void>;

  listNamespaces(): Promise<string[]>;

  deleteNamespaceMetadata(namespace: string): Promise<void>;

  upsertMetricMetadata(namespace: string, metricName: string, dimensions: Dimension[]): Promise<void>;

  addMetricDimensions(namespace: string, metricName: string, dimensions: Dimension[]): Promise<void>;

  listMetricNames(namespace: string): Promise<string[]>;

  listMetricMetadatas(request: ListMetricMetadataRequest): Promise<MetricMetadata[]>;

  getMetricMetadata(namespace: string, metricName: string): Promise<MetricMetadata | undefined>;

  // agent operation
  createTemporaryRawMetricsReference(request: CreateTemporaryRawMetricsReferenceRequest): Promise<CreateTemporaryRawMetricsReferenceResponse>;

  completeTemporaryRawMetricsUpload(request: CompleteTemporaryRawMetricsUploadRequest): Promise<void>;

  completeTemporaryRawMetricsProcessing(request: CompleteTemporaryRawMetricsProcessingRequest): Promise<void>;

  // 1-minute aggregator operation
  listTemporaryRawMetricsReferences(request: ListTemporaryRawMetricsReferencesRequest): Promise<RawMetricsReference[]>;

  createTemporaryMetricReference(request: CreateTemporaryMetricReferenceRequest): Promise<MetricReference>;

  completeTemporaryMetricUpload(request: CompleteTemporaryMetricUploadRequest): Promise<void>;

  // metrics partition operation, and operations
  listTemporaryMetricReferences(request: ListTemporaryMetricReferenceRequest): Promise<MetricReference[]>;

  createMetricReference(request: CreateMetricReferenceRequest): Promise<MetricReference>;

  // client operation
  listMetricReferences(request: ListMetricReferencesRequest): Promise<MetricReference[]>;
}

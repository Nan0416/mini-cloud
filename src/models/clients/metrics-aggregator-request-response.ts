import { Dimension, MetricReferenceTtl, Partition, MetricReference, RawMetricsReference, RawMetricsStatus } from '../models';

export interface ListTemporaryRawMetricsReferencesRequest {
  readonly status: RawMetricsStatus;
  readonly from: number;
  readonly limit: number;
  readonly sort: 'asc' | 'dec';
  readonly presignedUrl?: boolean; // require presigned url?
}

export interface ListTemporaryMetricReferenceRequest {
  readonly namespace: string;
  readonly period: number;
  readonly startTimestamp: number;
  readonly endTimestamp?: number;
}

export interface ListTemporaryRawMetricReferencesResponse {
  readonly references: RawMetricsReference[];
}

/**
 * Temporary (~1 day) metric reference, where all metrics within a namespace are put into the same artifact.
 * And the aggregation duration is typically very short, 1 minute, same as the period.
 */
export interface CreateTemporaryMetricReferenceRequest {
  readonly namespace: string;
  readonly period: number;
  readonly startTimestamp: number;
}

export interface CreateMetricReferenceRequest {
  readonly namespace: string;
  readonly metricName: string;
  readonly period: number;
  readonly startTimestamp: number;
  readonly endTimestamp: number;
  readonly ttl: MetricReferenceTtl;
}

/**
 * Temporary (~1 day) metric reference, where all metrics within a namespace are put into the same artifact.
 * And the aggregation duration is typically very short, 1 minute, same as the period.
 */
export interface UploadTemporaryMetricPartitionRequest extends CreateTemporaryMetricReferenceRequest {
  readonly partition: Partition;
}

export interface UploadMetricPartitionRequest extends CreateMetricReferenceRequest {
  readonly partition: Partition;
}

export interface LoadTemporaryMetricsRequest {
  readonly namespace: string;
  readonly period: number;
  readonly from: number;
  readonly to?: number;
}

export interface UpsertMetricDimensionsRequest {
  readonly namespace: string;
  readonly metricName: string;
  readonly dimensions: Dimension[];
}

export interface GetMetricDimensionsRequest {
  readonly namespace: string;
  readonly metricName: string;
}

export interface GetMetricDimensionsResponse {
  readonly dimensions: Dimension[];
}

export interface CompleteTemporaryRawMetricsProcessingRequest {
  readonly referenceId: string;
}

export interface CompleteTemporaryRawMetricsProcessingResponse {}

export interface CompleteTemporaryMetricUploadRequest {
  readonly namespace: string;
  readonly metricReference: MetricReference;
}

import { Dimension } from '../models';

export interface ListMetricMetadataRequest {
  readonly namespace: string;
  readonly from: number;
  readonly limit: number;
}

export interface LoadMetricsRequest {
  readonly namespace: string;
  readonly metricName: string;
  readonly period: number;
  readonly from: number;
  readonly to?: number;
}

export interface MetricWithDimenstionsRequest {
  readonly namespace: string;
  readonly from: number;
  readonly limit: number;
}

export interface MetricWithDimensions {
  readonly namespace: string;
  readonly metricName: string;
  readonly dimensions?: Dimension[];
}

export interface MetricWithDimensionsResponse {
  readonly metrics: MetricWithDimensions[];
}

export interface ListMetricReferencesRequest {
  readonly namespace: string;
  readonly metricName: string;
  readonly period: number;
  readonly startTimestamp: number;
  readonly endTimestamp?: number;
}

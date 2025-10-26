import { MetricReferenceTtl } from './common';

export interface MetricReference {
  readonly period: number;
  readonly startTimestamp: number;
  readonly endTimestamp: number;
  readonly artifactType: string;
  readonly artifactName: string;
  readonly ttl: MetricReferenceTtl;
  readonly createdAt: number;
}

export interface MetricReferenceNotification extends MetricReference {
  readonly namespace: string;
  readonly metricName?: string;
}

export type RawMetricsStatus = 'initiated' | 'uploaded' | 'processed';

export interface RawMetricsReferenceNotification {
  readonly referenceId: string;
  readonly agentId: string;
  readonly namespace: string;
  readonly createdAt: number;
  readonly status: RawMetricsStatus;
  readonly presignedUrl: string;
}

export interface RawMetricsReference {
  readonly referenceId: string;
  readonly agentId: string;
  readonly namespace: string;
  readonly createdAt: number;
  readonly status: RawMetricsStatus;
  readonly presignedUrl?: string;
}

/**
 * Metrics agent runs on each host, they read raw metric items and persist them into metrics service owned s3 bucket
 * through presigned url, and a notification is sent to metrics watcher, which will read these raw items emitted by
 * hosts and aggregate by namespace.
 *
 * The aggregate duration is harcode to 1 minute.
 */
export interface CreateTemporaryRawMetricsReferenceRequest {
  readonly namespace: string;
  readonly agentId: string;
}

export interface CreateTemporaryRawMetricsReferenceResponse {
  readonly referenceId: string;
  readonly presignedUrl: string;
}

export interface CompleteTemporaryRawMetricsUploadRequest {
  readonly referenceId: string;
}

export interface CompleteTemporaryRawMetricsUploadResponse {}

export interface UploadRawMetricsRequest {
  readonly namespace: string;
  readonly rawMetrics: string;
}

export interface RetryBackoff {
  backoff(): Promise<void>;
  reset(): void;
}

export interface HealthCheckResult {
  readonly instanceId: string;
  readonly result: 'failed' | 'success';
}

export interface HealthCheckManager<T> {
  watchInstance(taskInstanceId: string, config: T): void;
  removeInstance(taskInstanceId: string): void;
  healthCheck(prev: ReadonlyMap<string, 'failed' | 'success'>): Promise<HealthCheckResult[]>;
}

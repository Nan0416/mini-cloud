import { LoggerFactory } from '@sparrow/logging-js';
import { PassiveHealthCheck } from '../../models';
import { HealthCheckManager, HealthCheckResult } from './health-check-manager';

const logger = LoggerFactory.getLogger('PassiveHealthCheckManager');
const DEFAULT_PASSIVE_HEALTH_CHECK_PERIDO_IN_MS = 5000;

export interface PassiveHealthCheckManagerProps {
  readonly toleranceBuffer: number;
}

export class PassiveHealthCheckManager implements HealthCheckManager<PassiveHealthCheck> {
  private readonly taskInstanceIdToDuration: Map<string, number>;
  private readonly taskInstanceIdToLatestPingTimestamp: Map<string, number>;
  private readonly props: PassiveHealthCheckManagerProps;

  constructor(props: PassiveHealthCheckManagerProps) {
    this.taskInstanceIdToDuration = new Map();
    this.taskInstanceIdToLatestPingTimestamp = new Map();
    this.props = props;
  }

  async healthCheck(prev: ReadonlyMap<string, 'failed' | 'success'>): Promise<HealthCheckResult[]> {
    logger.debug('running passive health check');
    const results: HealthCheckResult[] = [];
    const entries = Array.from(this.taskInstanceIdToDuration.entries());
    const referenceTime = Date.now();

    for (let i = 0; i < entries.length; i++) {
      const taskInstanceId = entries[i][0];
      const duration = entries[i][1];
      const latestPingTime = this.taskInstanceIdToLatestPingTimestamp.get(taskInstanceId);
      // 2 seconds buffer.
      const success = latestPingTime !== undefined && referenceTime - latestPingTime <= duration + this.props.toleranceBuffer;
      results.push({
        instanceId: taskInstanceId,
        result: success ? 'success' : 'failed',
      });
    }
    return results;
  }

  watchInstance(taskInstanceId: string, config: PassiveHealthCheck): void {
    const duration = this.getPeriodInMs(config);
    logger.info(`watch task instance ${taskInstanceId} with passive health check manager with duration ${duration} ms`);
    this.taskInstanceIdToDuration.set(taskInstanceId, duration);
    this.taskInstanceIdToLatestPingTimestamp.set(taskInstanceId, Date.now());
  }

  removeInstance(taskInstanceId: string): void {
    logger.info(`stop watching task instance ${taskInstanceId}`);
    this.taskInstanceIdToDuration.delete(taskInstanceId);
    this.taskInstanceIdToLatestPingTimestamp.delete(taskInstanceId);
  }

  handlePing(taskInstanceId: string) {
    this.taskInstanceIdToLatestPingTimestamp.set(taskInstanceId, Date.now());
  }

  getPeriodInMs(healthCheck: PassiveHealthCheck): number {
    return healthCheck.periodInMs ?? DEFAULT_PASSIVE_HEALTH_CHECK_PERIDO_IN_MS;
  }
}

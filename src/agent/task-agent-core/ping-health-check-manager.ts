import { LoggerFactory } from '@sparrow/logging-js';
import { PingHealthCheck } from '../../models';
import { HttpClient } from '@sparrow/http-client';
import { HealthCheckManager, HealthCheckResult } from './health-check-manager';
import lodash from 'lodash';

const logger = LoggerFactory.getLogger('PingHealthCheckManager');
const DEFAULT_PING_HEALTH_CHECK_PERIDO_IN_MS = 5000;
const DEFAULT_CONSECUTIVE_FAILURE_DATA_POINT = 3;

export class PingHealthCheckManager implements HealthCheckManager<PingHealthCheck> {
  private readonly httpClient: HttpClient;
  private readonly instanceIdToConfig: Map<string, PingHealthCheck>;
  private readonly instanceIdToLastPingAt: Map<string, number>;
  private readonly instanceIdToConsecutiveFailure: Map<string, number>;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
    this.instanceIdToConfig = new Map();
    this.instanceIdToLastPingAt = new Map();
    this.instanceIdToConsecutiveFailure = new Map();
  }

  watchInstance(taskInstanceId: string, config: PingHealthCheck): void {
    logger.info(`watch ping health check on ${taskInstanceId}, ping request domain ${config.domain} path ${config.path} duration ${config.periodInMs}`);
    this.instanceIdToConfig.set(taskInstanceId, config);
  }

  removeInstance(taskInstanceId: string): void {
    logger.info(`remove ping health check on ${taskInstanceId}`);
    this.instanceIdToConfig.delete(taskInstanceId);
    this.instanceIdToLastPingAt.delete(taskInstanceId);
    this.instanceIdToConsecutiveFailure.delete(taskInstanceId);
  }

  async healthCheck(prev: ReadonlyMap<string, 'failed' | 'success'>): Promise<HealthCheckResult[]> {
    logger.debug('running ping health check');
    const results: HealthCheckResult[] = [];

    const checklist: [string, PingHealthCheck][] = [];
    const referenceTime = Date.now();

    this.instanceIdToConfig.forEach((config, instanceId) => {
      const period = config.periodInMs ?? DEFAULT_PING_HEALTH_CHECK_PERIDO_IN_MS;
      const lastPingAt = this.instanceIdToLastPingAt.get(instanceId);
      if (lastPingAt === undefined || lastPingAt + period < referenceTime) {
        checklist.push([instanceId, config]);
      } else {
        results.push({
          instanceId: instanceId,
          result: prev.get(instanceId) ?? 'success', // default success in case the instance is a newly launched instance.
        });
      }
    });

    const chunks = lodash.chunk(checklist, 10);
    for (let i = 0; i < chunks.length; i++) {
      await Promise.all(
        chunks[i].map(async (temp) => {
          const instanceId = temp[0];
          const success = await this.ping(referenceTime, temp[0], temp[1].domain, temp[1].path);
          let consecutiveFailure = 0;
          if (success) {
            // success, reset consecutive failure count.
            this.instanceIdToConsecutiveFailure.delete(instanceId);
          } else {
            // failure, increment consecutive failure count.
            consecutiveFailure = this.instanceIdToConsecutiveFailure.get(instanceId) ?? 0;
            consecutiveFailure += 1;
            this.instanceIdToConsecutiveFailure.set(instanceId, consecutiveFailure);
          }
          // todo: configurable.
          logger.debug(`instance consecutive ping health check failure is ${consecutiveFailure}`);
          const dataPointToFailure = DEFAULT_CONSECUTIVE_FAILURE_DATA_POINT;
          results.push({
            instanceId: instanceId,
            result: consecutiveFailure < dataPointToFailure ? 'success' : 'failed',
          });
        }),
      );
    }

    return results;
  }

  private async ping(referenceTime: number, instanceId: string, domain: string, path?: string): Promise<boolean> {
    try {
      logger.debug(`ping domain ${domain} path ${path}`);
      this.instanceIdToLastPingAt.set(instanceId, referenceTime);
      await this.httpClient.send({
        method: 'GET',
        baseUrl: domain,
        url: path ?? '/ping',
      });
      return true;
    } catch (err: any) {
      logger.info(`failed ping domain ${domain} path ${path}`);
      return false;
    }
  }
}

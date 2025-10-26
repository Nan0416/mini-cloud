import { HealthCheckResult } from './health-check-manager';

export interface HealthCheckResultsDelta {
  readonly instancesBecomeSuccessful: string[];
  readonly instancesBecomeFailed: string[];
}

export function healthCheckResultsDelta(prev: ReadonlyMap<string, 'success' | 'failed'>, current: ReadonlyArray<HealthCheckResult>): HealthCheckResultsDelta {
  // instance becomes successful if it's failed in the prev and success in the current.
  const instancesBecomeSuccessful = current
    .filter((item) => item.result === 'success')
    .map((item) => item.instanceId)
    .filter((instanceId) => {
      return prev.get(instanceId) === 'failed';
    });

  // instance becomes failed if it's successful  in the prev and failed in the current.
  const instancesBecomeFailed = current
    .filter((item) => item.result === 'failed')
    .map((item) => item.instanceId)
    .filter((instanceId) => {
      /**
       * undefined or success.
       *
       * undefined because when the task agent relaunches, the prev map is always empty.
       *
       * Attention, the agent may always report the failure before the it goes down, so including undefined condition may
       * cause duplicated report.
       * */
      return prev.get(instanceId) !== 'failed';
    });

  return {
    instancesBecomeFailed: instancesBecomeFailed,
    instancesBecomeSuccessful: instancesBecomeSuccessful,
  };
}

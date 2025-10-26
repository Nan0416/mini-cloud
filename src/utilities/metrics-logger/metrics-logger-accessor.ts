import { MetricsLogger } from '../../models';
import { NoopMetricsLogger } from './noop-metrics-logger';

let __metricsLogger: MetricsLogger | undefined = undefined;

export function setMetricsLogger(metricsLogger: MetricsLogger) {
  __metricsLogger = metricsLogger;
}

export function getMetricsLogger(): MetricsLogger {
  return __metricsLogger ? __metricsLogger : new NoopMetricsLogger('');
}

export function hasMetricsLogger(): boolean {
  return __metricsLogger !== undefined;
}

export function resetMetricsLogger() {
  __metricsLogger = undefined;
}

export async function closeMetricsLogger() {
  if (__metricsLogger) {
    await __metricsLogger.close();
    __metricsLogger = undefined;
  }
}

export function setMetricsLoggerIfMissing(builder: () => MetricsLogger) {
  if (__metricsLogger === undefined) {
    __metricsLogger = builder();
  }
}

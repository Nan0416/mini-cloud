import { FileMetricsLogger } from '@qinnan/file-metrics-logger';
import { LoggerFactory } from '@qinnan/logging-js';
import { WinstonLoggerBuilder } from '@qinnan/logging-winston';
import { ConsoleMetricsLogger, setMetricsLogger } from '@qinnan/metrics-logger';
import { getenv, isProd, stage as getStage } from '@qinnan/utilities';
import { config } from 'dotenv';

config();

const stage = getStage();
const logRootDir = `${getenv('HOME')}/${getenv('LOG_LOCATION')}/${stage}`;

LoggerFactory.setBuilder(
  new WinstonLoggerBuilder(
    isProd()
      ? {
          outputDir: `${logRootDir}/task-agent`,
          prefix: 'task-agent',
          type: 'utilities',
          maxFiles: '30d',
        }
      : undefined,
    {
      TaskAgentFacadeImpl: { level: 'debug' },
      PingHealthCheckManager: { level: 'debug' },
    },
  ),
);

LoggerFactory.setBuilder(
  new WinstonLoggerBuilder(
    isProd()
      ? {
          outputDir: `${logRootDir}/task-agent-access`,
          prefix: 'task-agent-access',
          type: 'utilities',
        }
      : undefined,
    {},
  ),
  'LoggingMiddleware',
);

const namespace = stage === 'prod' ? 'TaskAgent' : `TaskAgent.${stage.toUpperCase()}`;
const enableMetrics = getenv('ENABLE_METRICS', 'false').toLowerCase() === 'true';

if (enableMetrics) {
  const toConsole = getenv('METRICS_LOCATION', 'console').toLowerCase() === 'console';
  if (toConsole) {
    setMetricsLogger(new ConsoleMetricsLogger(namespace));
  } else {
    const metricsRootDir = `${getenv('HOME')}/${getenv('METRICS_LOCATION')}`;
    setMetricsLogger(new FileMetricsLogger(namespace, metricsRootDir));
  }
}

import { config as loadEnv } from 'dotenv';
loadEnv();

import { ConsoleLoggerBuilder, LoggerFactory } from '@sparrow/logging-js';
import { ConsoleMetricsFactory, MetricsContext } from '@sparrow/metrics-logger';
import config from './stage-config';

MetricsContext.setMetrics(new ConsoleMetricsFactory(config.appName).create());

LoggerFactory.setBuilder(new ConsoleLoggerBuilder({}));

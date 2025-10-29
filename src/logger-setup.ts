import { config as loadEnv } from 'dotenv';
loadEnv();

import { ConsoleLoggerBuilder, LoggerFactory, ConsoleMetricsFactory, MetricsContext } from '@ultrasa/dev-kit';

import config from './stage-config';

MetricsContext.setDefaultNamespace(config.appName);
MetricsContext.setMetricsFactory(new ConsoleMetricsFactory());

LoggerFactory.setBuilder(new ConsoleLoggerBuilder({}));

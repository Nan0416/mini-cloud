import 'source-map-support/register';
import './logger-setup';
import { enableExceptionCatpors } from '@ultrasa/dev-kit';
enableExceptionCatpors();

import mongoose from 'mongoose';
import { LoggerFactory } from '@ultrasa/dev-kit';
import config from './stage-config';
import { Service } from './service';
import { Server } from 'http';
import { DependencyFactory } from './dependencies/dependency-factory';

const logger = LoggerFactory.getLogger('main');

let httpServer: Server | undefined;
let terminationCallback: (() => Promise<void>) | undefined = undefined;

process.on('SIGINT', async () => {
  logger.info(`Terminating user service.`);
  httpServer?.close();
  if (terminationCallback) {
    await terminationCallback();
  }
  await mongoose.connection.close();
  logger.info(`Server closed.`);
  process.exit();
});

(async () => {
  await mongoose.connect(config.mongodbUri);
  const factory = new DependencyFactory({
    messageWebsocketPort: config.websocketPort,
    taskTopic: config.taskTopic,
    fsVariablesPath: config.fsVariablesPath,
    taskAgents: config.taskAgents,
    discordNotifierConfigs: config.discordNotifierConfigs,
  });

  const dependencies = await factory.build();
  terminationCallback = dependencies.terminationCallback;

  const service = new Service({
    messageEndpoints: dependencies.messageEndpoints,
    taskEndpoints: dependencies.taskEndpoints,
    issueEndpoints: dependencies.issueEndpoints,
  });

  const app = service.init();
  httpServer = app.listen(config.servicePort);

  logger.info(`Launched mini cloud at port ${config.servicePort}.`);
})();

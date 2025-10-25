import 'source-map-support/register';
import './logger-setup';
import '@sparrow/node-exception-captors';

import { LoggerFactory } from '@sparrow/logging-js';
// import config from './stage-config';
// import { DependencyFactory } from './dependencies/dependency-factory';
// import { Service } from './service';
import { Server } from 'http';

const logger = LoggerFactory.getLogger('main');

let httpServer: Server | undefined;

process.on('SIGINT', async () => {
  logger.info(`Terminating user service.`);
  httpServer?.close();
  logger.info(`Server closed.`);
  process.exit();
});

(async () => {
  //   const factory = new DependencyFactory({
  //     appName: config.appName,
  //     region: config.region,
  //     ddbTableNames: config.ddbTableNames,
  //     firstPartyCognitoUserPoolId: config.firstPartyCognitoUserPoolId,
  //     credentials: applicationRole
  //   });

  //   const dependencies = await factory.build();

  //   const service = new UserService({
  //     xxxEndpoint: dependencies.xxxEndpoints,
  //   });

  //   const app = service.init();
  //   httpServer = app.listen(config.localPort);

  logger.info('Launched user service.');
})();

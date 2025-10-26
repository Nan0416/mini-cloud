import './logger-setup';
import '@qinnan/node-exception-captors';

import { TaskAgentServer, TaskServiceEventHandler } from './endpoints';
import { LoggerFactory } from '@qinnan/logging-js';
import config from './stage-config';
import { authHttpClient, AccessKeyTokenProvider } from '@qinnan/auth-http-client';
import { StatefulWsSubscriber, NodeSubscriberImpl } from '@qinnan/message-subscriber';
import { TaskAgentFacadeImpl } from './task-agent-core';
import { TaskServiceEvent } from '@qinnan/task-types';
import { InternalClientImpl } from './internal-client';
import { TaskLauncher } from './task-agent-core/task-launcher';
import { VariableReplacement } from './task-agent-core/variable-replacement';
import { PassiveHealthCheckManager } from './task-agent-core/passive-health-check-manager';
import { PingHealthCheckManager } from './task-agent-core/ping-health-check-manager';
import { mkdirSync } from 'fs';
import axios from 'axios';
import path from 'path';

const logger = LoggerFactory.getLogger('main');
const tokenProvider = new AccessKeyTokenProvider(
  {
    accessKey: config.accessKey,
    secretKey: config.secretKey,
  },
  {
    authTokenEndpoint: config.authTokenEndpoint,
    clientId: config.appName,
  },
);

mkdirSync(config.variableReplacementConfig.stdoutDir, { recursive: true });
mkdirSync(config.variableReplacementConfig.stderrDir, { recursive: true });
mkdirSync(path.dirname(config.offlineReportPath), { recursive: true });

(async () => {
  try {
    const internalClient = new InternalClientImpl(config.agentId, config.agentName, authHttpClient(config.taskDomain, tokenProvider));
    const taskAgentFacade = new TaskAgentFacadeImpl({
      client: internalClient,
      taskLauncher: new TaskLauncher(config.agentId),
      variableReplacement: new VariableReplacement(config.variableReplacementConfig),
      passiveHealthCheckManager: new PassiveHealthCheckManager({
        toleranceBuffer: config.passiveHealthCheckToleranceBuffer,
      }),
      pingHealthCheckManager: new PingHealthCheckManager(axios.create({ timeout: 3_000 })),
      offlineReportPath: config.offlineReportPath,
    });

    await taskAgentFacade.init();

    const taskServiceEventHandler = new TaskServiceEventHandler(config.agentId, taskAgentFacade);
    logger.info(`initialize subscription on task topic ${config.taskTopic}`);
    const subscriber = new StatefulWsSubscriber(() => new NodeSubscriberImpl<TaskServiceEvent>(config.streamDomain));
    await subscriber.init();
    subscriber.onEvent = (event) => taskServiceEventHandler.process(event);
    await subscriber.subscribe(config.taskTopic);

    // listen to task.
    logger.info('initialize task agent server');
    const taskAgentServer = new TaskAgentServer(
      {
        agentId: config.agentId,
        port: config.port,
      },
      taskAgentFacade,
    );

    await taskAgentServer.start();

    process.on('SIGINT', async () => {
      logger.info('handle termination signal, terminate subscriber and task agent server');
      await subscriber.close();
      await taskAgentServer.terminate();
      await taskAgentFacade.terminate();
      process.exit();
    });

    logger.info('successfully started task agent service');
  } catch (err) {
    const message = `Failed to start task agent service.`;
    logger.error(message, err);
    process.exit(-1);
  }
})();
